from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from backend.app.auth.security import (
    create_access_token,
    enforce_login_rate_limit,
    get_current_user,
    require_roles,
    verify_password,
)
from backend.app.config.database import get_db_connection, get_mongo_db
from backend.app.schemas.domain import (
    AvailabilityUpdateRequest,
    LoginRequest,
    TokenResponse,
    UserProfileOut,
)

router = APIRouter(prefix="/auth", tags=["Authentication & Staff Self-Service"])


@router.post("/login", response_model=TokenResponse)
async def staff_login(
    payload: LoginRequest,
    request: Request,
    conn: Connection = Depends(get_db_connection),
) -> TokenResponse:
    enforce_login_rate_limit(request)

    user_row = conn.execute(
        text(
            """
            SELECT u.user_id, u.username, u.email, u.password_hash, u.linked_staff_id,
                   u.auth_provider, u.is_active, s.display_name AS staff_name, s.dept_id
            FROM users u
            LEFT JOIN staff s ON s.staff_id = u.linked_staff_id
            WHERE u.username = :uname OR u.email = :uname
            LIMIT 1
            """
        ),
        {"uname": payload.username.strip()},
    ).mappings().first()

    if not user_row or not user_row["is_active"] or not verify_password(payload.password, user_row["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials or inactive staff account.",
        )

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
            {"uid": user_row["user_id"]},
        ).scalars().all()
    )

    conn.execute(
        text("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = :uid"),
        {"uid": user_row["user_id"]},
    )
    conn.execute(
        text(
            """
            INSERT INTO change_audit_log (user_id, action_type, table_name, record_id, new_value)
            VALUES (:uid, 'AUTH_EVENT', 'users', :uid, JSON_OBJECT('event', 'LOGIN_SUCCESS'))
            """
        ),
        {"uid": user_row["user_id"]},
    )
    conn.commit()

    try:
        mdb = get_mongo_db()
        await mdb.system_events.insert_one(
            {
                "event_type": "STAFF_LOGIN",
                "username": user_row["username"],
                "roles": roles,
                "created_at": datetime.now(timezone.utc),
            }
        )
    except Exception:
        pass

    token = create_access_token(user_row["user_id"], user_row["username"], roles)
    return TokenResponse(
        access_token=token,
        user=UserProfileOut(
            user_id=user_row["user_id"],
            username=user_row["username"],
            email=user_row["email"],
            linked_staff_id=user_row["linked_staff_id"],
            staff_name=user_row["staff_name"],
            dept_id=user_row["dept_id"],
            auth_provider=user_row["auth_provider"],
            roles=roles,
        ),
    )


@router.get("/me", response_model=UserProfileOut)
def get_my_profile(current_user: dict[str, Any] = Depends(get_current_user)) -> UserProfileOut:
    return UserProfileOut(**current_user)


@router.put("/availability")
def update_faculty_availability(
    payload: AvailabilityUpdateRequest,
    current_user: dict[str, Any] = Depends(
        require_roles("FACULTY_STAFF", "DEPT_COORDINATOR", "SYSTEM_ADMIN")
    ),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    user_roles = set(current_user["roles"])
    target_staff_id = payload.staff_id or current_user.get("linked_staff_id")

    if not target_staff_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No faculty/staff profile is linked to this account.",
        )

    if target_staff_id != current_user.get("linked_staff_id"):
        if not user_roles.intersection({"DEPT_COORDINATOR", "SYSTEM_ADMIN"}):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Faculty members may only update their own availability status.",
            )

    source_type = (
        "FACULTY_SELF"
        if target_staff_id == current_user.get("linked_staff_id")
        else "DEPARTMENT_OFFICE"
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    valid_until = now + timedelta(minutes=payload.valid_minutes)

    conn.execute(
        text(
            """
            INSERT INTO faculty_availability
            (staff_id, availability_state, source_type, public_note, valid_from, valid_until, updated_by_user_id)
            VALUES (:sid, :st, :src, :note, :vfrom, :vuntil, :uid)
            """
        ),
        {
            "sid": target_staff_id,
            "st": payload.availability_state,
            "src": source_type,
            "note": payload.public_note.strip() if payload.public_note else None,
            "vfrom": now,
            "vuntil": valid_until,
            "uid": current_user["user_id"],
        },
    )
    conn.commit()

    return {
        "staff_id": target_staff_id,
        "availability_state": payload.availability_state,
        "source_type": source_type,
        "valid_until": valid_until.isoformat(),
    }
