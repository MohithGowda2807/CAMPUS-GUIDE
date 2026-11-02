from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
import time
from typing import Any, Callable

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.engine import Connection

from backend.app.config.database import get_mysql_engine
from backend.app.config.settings import get_settings

bearer_scheme = HTTPBearer(auto_error=False)

# In-memory sliding window login rate limiter (protects authentication endpoint)
_login_attempts: dict[str, list[float]] = defaultdict(list)
MAX_LOGIN_ATTEMPTS_PER_WINDOW = 10
LOGIN_WINDOW_SECONDS = 300


def enforce_login_rate_limit(request: Request) -> None:
    client_ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    recent = [ts for ts in _login_attempts[client_ip] if now - ts < LOGIN_WINDOW_SECONDS]
    if len(recent) >= MAX_LOGIN_ATTEMPTS_PER_WINDOW:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many authentication attempts. Please wait 5 minutes before retrying.",
        )
    recent.append(now)
    _login_attempts[client_ip] = recent


def hash_password(plain_password: str) -> str:
    return bcrypt.hashpw(plain_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(user_id: int, username: str, roles: list[str]) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "username": username,
        "roles": roles,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def _fetch_user_profile(conn: Connection, user_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        text(
            """
            SELECT u.user_id, u.username, u.email, u.linked_staff_id, u.auth_provider,
                   u.is_active, u.last_login_at, s.display_name AS staff_name, s.dept_id
            FROM users u
            LEFT JOIN staff s ON s.staff_id = u.linked_staff_id
            WHERE u.user_id = :uid
            """
        ),
        {"uid": user_id},
    ).mappings().first()

    if not row or not row["is_active"]:
        return None

    roles = conn.execute(
        text(
            """
            SELECT r.role_code
            FROM user_roles ur
            INNER JOIN roles r ON r.role_id = ur.role_id
            WHERE ur.user_id = :uid
            ORDER BY r.role_code
            """
        ),
        {"uid": user_id},
    ).scalars().all()

    return {
        "user_id": row["user_id"],
        "username": row["username"],
        "email": row["email"],
        "linked_staff_id": row["linked_staff_id"],
        "staff_name": row["staff_name"],
        "dept_id": row["dept_id"],
        "auth_provider": row["auth_provider"],
        "roles": list(roles),
    }


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any] | None:
    if credentials is None:
        return None
    settings = get_settings()
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
    with get_mysql_engine().connect() as conn:
        return _fetch_user_profile(conn, user_id)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    settings = get_settings()
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    with get_mysql_engine().connect() as conn:
        user = _fetch_user_profile(conn, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is inactive or no longer exists.",
        )
    return user


def require_roles(*allowed_roles: str) -> Callable[..., dict[str, Any]]:
    allowed_set = set(allowed_roles)

    def _dependency(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        user_roles = set(current_user.get("roles", []))
        if "SYSTEM_ADMIN" in user_roles or user_roles.intersection(allowed_set):
            return current_user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient role permissions for this operation.",
        )

    return _dependency
