from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
import time
from typing import Any, Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.engine import Connection

from backend.app.auth.cognito_verifier import verify_cognito_jwt
from backend.app.auth.data_protection import hash_jti
from backend.app.config.database import get_mysql_engine

bearer_scheme = HTTPBearer(auto_error=False)

# Sliding-window rate limiters for authentication, registration, and recovery abuse prevention
_rate_buckets: dict[str, list[float]] = defaultdict(list)
MAX_AUTH_REQUESTS_PER_WINDOW = 15
AUTH_WINDOW_SECONDS = 300

# Canonical Role Equivalences (Supports Phase 6 canonical roles + existing operational sub-roles)
_ROLE_EXPANSION: dict[str, set[str]] = {
    "ADMIN": {"ADMIN", "SYSTEM_ADMIN", "FACILITY_ADMIN", "DEPT_COORDINATOR", "STAFF", "FACULTY"},
    "SYSTEM_ADMIN": {"ADMIN", "SYSTEM_ADMIN", "FACILITY_ADMIN", "DEPT_COORDINATOR", "STAFF", "FACULTY"},
    "FACILITY_ADMIN": {"FACILITY_ADMIN", "STAFF"},
    "DEPT_COORDINATOR": {"DEPT_COORDINATOR", "FACULTY", "FACULTY_STAFF"},
    "FACULTY": {"FACULTY", "FACULTY_STAFF"},
    "FACULTY_STAFF": {"FACULTY", "FACULTY_STAFF"},
    "STAFF": {"STAFF", "SECURITY_RECEPTION"},
    "SECURITY_RECEPTION": {"STAFF", "SECURITY_RECEPTION"},
}


def reset_rate_limits_for_tests() -> None:
    _rate_buckets.clear()


def enforce_auth_rate_limit(request: Request, bucket_prefix: str = "auth") -> None:
    client_ip = request.client.host if request.client else "unknown"
    key = f"{bucket_prefix}:{client_ip}"
    now = time.monotonic()
    recent = [ts for ts in _rate_buckets[key] if now - ts < AUTH_WINDOW_SECONDS]
    if len(recent) >= MAX_AUTH_REQUESTS_PER_WINDOW:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many authentication requests. Please wait a few minutes before retrying.",
        )
    recent.append(now)
    _rate_buckets[key] = recent


def expand_effective_roles(assigned_roles: list[str]) -> set[str]:
    expanded: set[str] = set()
    for r in assigned_roles:
        expanded.add(r)
        expanded.update(_ROLE_EXPANSION.get(r, set()))
    return expanded


def _is_token_revoked(conn: Connection, raw_token: str, claims: dict[str, Any], user_row: Any | None) -> bool:
    jti = str(claims.get("jti") or raw_token)
    jti_digest = hash_jti(jti)
    revoked_hit = conn.execute(
        text("SELECT 1 FROM revoked_token_jtis WHERE jti_hash = :jh LIMIT 1"),
        {"jh": jti_digest},
    ).scalar()
    if revoked_hit:
        return True

    if user_row and user_row.get("tokens_valid_after_epoch") is not None:
        cutoff_epoch = int(user_row["tokens_valid_after_epoch"])
        token_iat = int(claims.get("iat", 0))
        if token_iat < cutoff_epoch:
            return True

    return False


def fetch_user_by_cognito_sub(conn: Connection, cognito_sub: str) -> dict[str, Any] | None:
    row = conn.execute(
        text(
            """
            SELECT u.user_id, u.cognito_sub, u.username, u.email, u.full_name,
                   u.linked_staff_id, u.auth_provider, u.email_verified, u.mfa_enabled,
                   u.approval_status, u.status_reason,
                   UNIX_TIMESTAMP(u.tokens_valid_after) AS tokens_valid_after_epoch,
                   u.is_active, u.last_login_at,
                   s.display_name AS staff_name, s.dept_id, s.designation,
                   s.employee_code, d.dept_code, d.dept_name
            FROM users u
            LEFT JOIN staff s ON s.staff_id = u.linked_staff_id
            LEFT JOIN departments d ON d.dept_id = s.dept_id
            WHERE u.cognito_sub = :csub
            LIMIT 1
            """
        ),
        {"csub": cognito_sub},
    ).mappings().first()

    if not row:
        return None

    roles = list(
        conn.execute(
            text(
                """
                SELECT r.role_code
                FROM user_roles ur
                INNER JOIN roles r ON r.role_id = ur.role_id
                WHERE ur.user_id = :uid
                ORDER BY r.role_code
                """
            ),
            {"uid": row["user_id"]},
        ).scalars().all()
    )

    return {
        "user_id": row["user_id"],
        "cognito_sub": row["cognito_sub"],
        "username": row["username"],
        "email": row["email"],
        "full_name": row["full_name"],
        "linked_staff_id": row["linked_staff_id"],
        "staff_name": row["staff_name"],
        "dept_id": row["dept_id"],
        "dept_code": row["dept_code"],
        "dept_name": row["dept_name"],
        "designation": row["designation"],
        "employee_code": row["employee_code"],
        "auth_provider": row["auth_provider"],
        "email_verified": bool(row["email_verified"]),
        "mfa_enabled": bool(row["mfa_enabled"]),
        "approval_status": row["approval_status"],
        "status_reason": row["status_reason"],
        "tokens_valid_after_epoch": row["tokens_valid_after_epoch"],
        "is_active": bool(row["is_active"]),
        "roles": roles,
    }


def get_verified_token_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
    """
    Validates Cognito RS256 Bearer token and checks revocation, WITHOUT requiring the user
    to already be APPROVED in MySQL (used by registration completion & onboarding status checks).
    """
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    raw_token = credentials.credentials
    claims = verify_cognito_jwt(raw_token, allowed_token_uses=("access", "id"))
    sub = str(claims["sub"])

    with get_mysql_engine().connect() as conn:
        user = fetch_user_by_cognito_sub(conn, sub)
        if _is_token_revoked(conn, raw_token, claims, user):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session has been signed out or revoked. Please sign in again.",
                headers={"WWW-Authenticate": "Bearer"},
            )

    return {
        "raw_token": raw_token,
        "claims": claims,
        "user": user,
    }


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any] | None:
    if credentials is None or not credentials.credentials:
        return None
    try:
        claims = verify_cognito_jwt(credentials.credentials, allowed_token_uses=("access", "id"))
    except HTTPException:
        return None

    with get_mysql_engine().connect() as conn:
        user = fetch_user_by_cognito_sub(conn, str(claims["sub"]))
        if not user or _is_token_revoked(conn, credentials.credentials, claims, user):
            return None
        if user["approval_status"] != "APPROVED" or not user["is_active"] or not user["email_verified"]:
            return None
        return user


def get_current_user(
    ctx: dict[str, Any] = Depends(get_verified_token_context),
) -> dict[str, Any]:
    """
    Strict backend authorisation gate for all staff/faculty/admin operations:
    1. Valid unrevoked Cognito RS256 token
    2. Registered in `users` via `cognito_sub`
    3. `email_verified == True` and `@rvce.edu.in` domain
    4. `approval_status == 'APPROVED'` and `is_active == True`
    Default-deny for unverified, pending, rejected, suspended, or revoked accounts!
    """
    user = ctx.get("user")
    claims = ctx["claims"]

    if not user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Staff portal registration is incomplete or pending eligibility verification.",
        )

    if not user["email_verified"] or claims.get("email_verified") is False:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Institutional email ownership must be verified before accessing staff features.",
        )

    if not str(user["email"]).lower().endswith("@rvce.edu.in"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access restricted to verified @rvce.edu.in accounts.",
        )

    approval = user["approval_status"]
    if approval == "PENDING_APPROVAL":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your RVCE staff registration is pending administrator eligibility approval.",
        )
    if approval in ("REJECTED", "SUSPENDED", "REVOKED") or not user["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account access is not active ({approval}). Contact the RVCE Portal Administrator.",
        )

    if not user.get("roles"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No authorised institutional role is assigned to this account.",
        )

    user["_claims"] = claims
    user["_raw_token"] = ctx["raw_token"]
    return user


def require_roles(*allowed_roles: str) -> Callable[..., dict[str, Any]]:
    allowed_set = set(allowed_roles)

    def _dependency(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        effective = expand_effective_roles(current_user.get("roles", []))
        if effective.intersection(allowed_set):
            return current_user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient institutional role permissions for this operation.",
        )

    return _dependency
