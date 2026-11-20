from __future__ import annotations

from datetime import datetime, timezone
import re
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from backend.app.auth.data_protection import hash_jti, normalize_and_validate_rvce_email
from backend.app.auth.security import (
    enforce_auth_rate_limit,
    expand_effective_roles,
    fetch_user_by_cognito_sub,
    get_current_user,
    get_verified_token_context,
    require_roles,
)
from backend.app.config.database import get_db_connection, get_mongo_db
from backend.app.config.settings import get_settings
from backend.app.schemas.domain import (
    AvailabilityUpdateRequest,
    SessionStatusOut,
    StaffRegistrationCompleteRequest,
    StaffSelfProfileUpdateRequest,
    UserProfileOut,
)

router = APIRouter(prefix="/auth", tags=["Cognito Authentication & Faculty Self-Service"])

_REAUTH_MAX_AGE_SECONDS = 900  # 15-minute fresh auth requirement for sensitive changes


def _derive_unique_username(conn: Connection, normalized_email: str) -> str:
    base = re.sub(r"[^a-z0-9._-]", "", normalized_email.split("@", 1)[0])[:48] or "rvce.staff"
    candidate = base
    suffix = 1
    while conn.execute(
        text("SELECT 1 FROM users WHERE username = :u LIMIT 1"), {"u": candidate}
    ).scalar():
        suffix += 1
        candidate = f"{base[:44]}.{suffix}"
    return candidate


def _serialize_user_out(user: dict[str, Any]) -> UserProfileOut:
    clean = {
        k: v
        for k, v in user.items()
        if not k.startswith("_") and k not in ("tokens_valid_after", "tokens_valid_after_epoch", "status_reason")
    }
    return UserProfileOut(**clean)


@router.get("/config")
def get_public_auth_configuration(request: Request) -> dict[str, Any]:
    """
    Returns non-secret OIDC / Cognito public client configuration for Android & Web clients.
    Never exposes any secret, AWS access key, or private configuration.
    """
    settings = get_settings()
    if settings.use_aws_cognito:
        domain = settings.COGNITO_DOMAIN.strip().rstrip("/")
        return {
            "provider_mode": "AWS_COGNITO",
            "region": settings.COGNITO_REGION.strip(),
            "user_pool_id": settings.COGNITO_USER_POOL_ID.strip(),
            "client_id": settings.COGNITO_APP_CLIENT_ID.strip(),
            "issuer": settings.cognito_issuer,
            "oauth_domain": domain,
            "authorization_endpoint": f"{domain}/oauth2/authorize" if domain else None,
            "token_endpoint": f"{domain}/oauth2/token" if domain else None,
            "revocation_endpoint": f"{domain}/oauth2/revoke" if domain else None,
            "logout_endpoint": f"{domain}/logout" if domain else None,
            "cognito_idp_endpoint": f"https://cognito-idp.{settings.COGNITO_REGION.strip()}.amazonaws.com/",
            "redirect_uri": settings.COGNITO_REDIRECT_URI,
            "logout_uri": settings.COGNITO_LOGOUT_URI,
            "allowed_email_domain": settings.ALLOWED_STAFF_EMAIL_DOMAIN,
            "pkce_method": "S256",
        }

    base_url_str = str(request.base_url).rstrip("/")
    forwarded_proto = (request.headers.get("x-forwarded-proto") or "").lower()
    if (
        forwarded_proto == "https" or ".trycloudflare.com" in base_url_str
    ) and base_url_str.startswith("http://"):
        base_url_str = "https://" + base_url_str[len("http://") :]
    base_api = base_url_str + settings.API_V1_PREFIX
    return {
        "provider_mode": "DEV_OIDC_SANDBOX",
        "region": settings.COGNITO_REGION.strip(),
        "user_pool_id": "dev-local-pool",
        "client_id": settings.effective_client_id,
        "issuer": settings.cognito_issuer,
        "oauth_domain": f"{base_api}/dev-oidc",
        "authorization_endpoint": f"{base_api}/dev-oidc/oauth2/authorize",
        "token_endpoint": f"{base_api}/dev-oidc/oauth2/token",
        "revocation_endpoint": f"{base_api}/dev-oidc/oauth2/revoke",
        "logout_endpoint": None,
        "cognito_idp_endpoint": f"{base_api}/dev-oidc/cognito",
        "redirect_uri": settings.COGNITO_REDIRECT_URI,
        "logout_uri": settings.COGNITO_LOGOUT_URI,
        "allowed_email_domain": settings.ALLOWED_STAFF_EMAIL_DOMAIN,
        "pkce_method": "S256",
    }


@router.post("/complete-registration", response_model=SessionStatusOut)
async def complete_staff_registration(
    payload: StaffRegistrationCompleteRequest,
    request: Request,
    ctx: dict[str, Any] = Depends(get_verified_token_context),
    conn: Connection = Depends(get_db_connection),
) -> SessionStatusOut:
    """
    Binds a verified Cognito `sub` to the institutional `users` table.
    - Enforces exact `@rvce.edu.in` domain on both token claim (when present) and request body.
    - Rejects unverified emails (`email_verified != True`).
    - Checks administrator-managed `staff_eligibility_allowlist`:
      * Allowlisted -> `APPROVED` + assigned allowlisted role (`FACULTY` or `STAFF` — NEVER `ADMIN`).
      * Not allowlisted -> `PENDING_APPROVAL` (`is_active = FALSE`, zero roles, zero invented `staff` records).
    """
    enforce_auth_rate_limit(request, bucket_prefix="register")

    if not payload.terms_accepted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must accept the institutional account and privacy terms to register.",
        )

    claims = ctx["claims"]
    cognito_sub = str(claims["sub"])

    if claims.get("email_verified") is False:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email ownership must be verified before completing staff registration.",
        )

    normalized_email = normalize_and_validate_rvce_email(payload.email)
    claim_email = claims.get("email")
    if claim_email:
        norm_claim_email = normalize_and_validate_rvce_email(str(claim_email))
        if norm_claim_email != normalized_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Submitted email does not match the authenticated Cognito identity.",
            )

    existing_user = fetch_user_by_cognito_sub(conn, cognito_sub)
    if existing_user:
        st = existing_user["approval_status"]
        return SessionStatusOut(
            onboarding_status=st,
            email=existing_user["email"],
            email_verified=existing_user["email_verified"],
            status_reason=existing_user.get("status_reason"),
            user=_serialize_user_out(existing_user) if st == "APPROVED" else None,
        )

    # Check if an account row was pre-seeded by email (e.g., institutional seed account)
    by_email = conn.execute(
        text("SELECT user_id, approval_status FROM users WHERE email = :em LIMIT 1"),
        {"em": normalized_email},
    ).mappings().first()
    if by_email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An institutional account record already exists for this @rvce.edu.in address. Please sign in or contact the Portal Administrator.",
        )

    # Check controlled administrator-managed Staff Eligibility Allowlist
    allow_row = conn.execute(
        text(
            """
            SELECT allowlist_id, linked_staff_id, assigned_role_code
            FROM staff_eligibility_allowlist
            WHERE email = :em AND is_active = TRUE
            LIMIT 1
            """
        ),
        {"em": normalized_email},
    ).mappings().first()

    uname = _derive_unique_username(conn, normalized_email)
    full_name = payload.full_name.strip()
    amr_list = claims.get("amr") or []
    mfa_flag = bool("mfa" in amr_list or "swk" in amr_list)

    if allow_row:
        approval_status = "APPROVED"
        is_active = True
        linked_staff_id = allow_row["linked_staff_id"]
        role_to_assign = allow_row["assigned_role_code"]  # Strictly 'FACULTY' or 'STAFF'
        approved_at_sql = "CURRENT_TIMESTAMP"
    else:
        approval_status = "PENDING_APPROVAL"
        is_active = False
        linked_staff_id = None
        role_to_assign = None
        approved_at_sql = "NULL"

    res = conn.execute(
        text(
            f"""
            INSERT INTO users
            (cognito_sub, linked_staff_id, username, email, full_name, auth_provider,
             email_verified, mfa_enabled, approval_status, terms_accepted_at,
             approved_at, tokens_valid_after, is_active, last_login_at)
            VALUES (
                :csub, :sid, :uname, :em, :fname, 'COGNITO_OIDC',
                TRUE, :mfa, :astat, CURRENT_TIMESTAMP,
                {approved_at_sql}, DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 5 SECOND), :act, CURRENT_TIMESTAMP
            )
            """
        ),
        {
            "csub": cognito_sub,
            "sid": linked_staff_id,
            "uname": uname,
            "em": normalized_email,
            "fname": full_name,
            "mfa": mfa_flag,
            "astat": approval_status,
            "act": is_active,
        },
    )
    new_uid = int(res.lastrowid)

    if role_to_assign in ("FACULTY", "STAFF"):
        role_id = conn.execute(
            text("SELECT role_id FROM roles WHERE role_code = :rc LIMIT 1"),
            {"rc": role_to_assign},
        ).scalar()
        if role_id:
            conn.execute(
                text("INSERT INTO user_roles (user_id, role_id) VALUES (:uid, :rid)"),
                {"uid": new_uid, "rid": int(role_id)},
            )

    conn.execute(
        text(
            """
            INSERT INTO change_audit_log (user_id, action_type, table_name, record_id, new_value)
            VALUES (
                :uid, 'AUTH_EVENT', 'users', :uid,
                JSON_OBJECT('event', 'STAFF_REGISTRATION_SYNC', 'approval_status', :astat, 'allowlisted', :alw)
            )
            """
        ),
        {"uid": new_uid, "astat": approval_status, "alw": bool(allow_row)},
    )
    conn.commit()

    try:
        mdb = get_mongo_db()
        await mdb.system_events.insert_one(
            {
                "event_type": "STAFF_REGISTRATION",
                "user_id": new_uid,
                "approval_status": approval_status,
                "created_at": datetime.now(timezone.utc),
            }
        )
    except Exception:
        pass

    fresh_user = fetch_user_by_cognito_sub(conn, cognito_sub)
    return SessionStatusOut(
        onboarding_status=approval_status,
        email=normalized_email,
        email_verified=True,
        status_reason=None,
        user=_serialize_user_out(fresh_user) if (fresh_user and approval_status == "APPROVED") else None,
    )


@router.get("/session-status", response_model=SessionStatusOut)
def get_session_onboarding_status(
    ctx: dict[str, Any] = Depends(get_verified_token_context),
    conn: Connection = Depends(get_db_connection),
) -> SessionStatusOut:
    """
    Inspects the caller's Cognito identity and returns their institutional approval state
    (`UNREGISTERED_PROFILE`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `SUSPENDED`, `REVOKED`)
    without leaking staff portal data to unapproved accounts.
    """
    claims = ctx["claims"]
    email_verified = claims.get("email_verified", True) is not False
    user = ctx.get("user")

    if not user:
        claim_email = str(claims.get("email", "")) or None
        if claim_email:
            normalize_and_validate_rvce_email(claim_email)
        return SessionStatusOut(
            onboarding_status="UNREGISTERED_PROFILE",
            email=claim_email,
            email_verified=email_verified,
            status_reason=None,
            user=None,
        )

    st = user["approval_status"]
    if st == "APPROVED" and user["is_active"] and user["email_verified"] and email_verified:
        amr_list = claims.get("amr") or []
        has_mfa = bool("mfa" in amr_list or "swk" in amr_list or user["mfa_enabled"])
        conn.execute(
            text(
                """
                UPDATE users
                SET last_login_at = CURRENT_TIMESTAMP,
                    mfa_enabled = CASE WHEN :mfa = TRUE THEN TRUE ELSE mfa_enabled END
                WHERE user_id = :uid
                """
            ),
            {"uid": user["user_id"], "mfa": has_mfa},
        )
        conn.commit()
        user["mfa_enabled"] = has_mfa
        return SessionStatusOut(
            onboarding_status="APPROVED",
            email=user["email"],
            email_verified=True,
            status_reason=None,
            user=_serialize_user_out(user),
        )

    return SessionStatusOut(
        onboarding_status=st,
        email=user["email"],
        email_verified=bool(user["email_verified"] and email_verified),
        status_reason=user.get("status_reason"),
        user=None,
    )


@router.get("/me", response_model=UserProfileOut)
def get_my_profile(current_user: dict[str, Any] = Depends(get_current_user)) -> UserProfileOut:
    return _serialize_user_out(current_user)


@router.get("/profile")
def get_detailed_staff_profile(
    current_user: dict[str, Any] = Depends(require_roles("FACULTY", "STAFF", "ADMIN")),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    staff_id = current_user.get("linked_staff_id")
    if not staff_id:
        return {
            "user": _serialize_user_out(current_user).model_dump(),
            "staff_record": None,
            "available_rooms": [],
        }

    staff_row = conn.execute(
        text(
            """
            SELECT s.staff_id, s.employee_code, s.display_name, s.qualification,
                   s.designation, s.cadre_rank, s.program_name, s.leadership_role,
                   s.staff_type, s.association_nature, s.employment_mode,
                   s.public_email, s.official_profile_url, s.profile_visibility,
                   s.verification_status, s.status,
                   d.dept_id, d.dept_code, d.dept_name,
                   r.room_id AS office_room_id, r.room_number AS office_room_number,
                   r.room_name AS office_room_name,
                   b.building_id, b.building_code, b.building_name
            FROM staff s
            INNER JOIN departments d ON d.dept_id = s.dept_id
            LEFT JOIN rooms r ON r.room_id = s.office_room_id
            LEFT JOIN floors f ON f.floor_id = r.floor_id
            LEFT JOIN buildings b ON b.building_id = COALESCE(f.building_id, d.primary_building_id)
            WHERE s.staff_id = :sid
            LIMIT 1
            """
        ),
        {"sid": staff_id},
    ).mappings().first()

    rooms = conn.execute(
        text(
            """
            SELECT r.room_id, r.room_number, r.room_name, b.building_code, b.building_name
            FROM rooms r
            INNER JOIN floors f ON f.floor_id = r.floor_id
            INNER JOIN buildings b ON b.building_id = f.building_id
            WHERE r.status = 'ACTIVE'
            ORDER BY b.building_code ASC, r.room_number ASC
            """
        )
    ).mappings().all()

    return {
        "user": _serialize_user_out(current_user).model_dump(),
        "staff_record": dict(staff_row) if staff_row else None,
        "available_rooms": [dict(rm) for rm in rooms],
    }


@router.patch("/profile")
def update_my_staff_profile(
    payload: StaffSelfProfileUpdateRequest,
    current_user: dict[str, Any] = Depends(require_roles("FACULTY", "STAFF", "ADMIN")),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    """
    Allows an authenticated faculty/staff member to update ONLY their own approved self-service
    profile fields (`office_room_id`, `public_email`, `official_profile_url`, `profile_visibility`).
    Enforces fresh authentication (`auth_time` <= 15 minutes) when changing email or visibility.
    """
    staff_id = current_user.get("linked_staff_id")
    if not staff_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No institutional staff directory profile is linked to this account.",
        )

    claims = current_user.get("_claims") or {}
    auth_time = int(claims.get("auth_time") or claims.get("iat") or 0)
    if int(time.time()) - auth_time > _REAUTH_MAX_AGE_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Recent authentication is required for profile changes. Please re-authenticate.",
        )

    validated_pub_email: str | None = None
    if payload.public_email and payload.public_email.strip():
        validated_pub_email = normalize_and_validate_rvce_email(payload.public_email)

    if payload.office_room_id is not None:
        rm_exists = conn.execute(
            text("SELECT 1 FROM rooms WHERE room_id = :rid AND status = 'ACTIVE' LIMIT 1"),
            {"rid": payload.office_room_id},
        ).scalar()
        if not rm_exists:
            raise HTTPException(status_code=400, detail="Selected office room does not exist.")

    profile_url = payload.official_profile_url.strip() if payload.official_profile_url else None
    if profile_url and not (profile_url.startswith("https://") or profile_url.startswith("http://")):
        raise HTTPException(status_code=400, detail="Official profile URL must start with https://.")

    conn.execute(text("SET @current_app_user_id = :uid"), {"uid": current_user["user_id"]})
    conn.execute(
        text(
            """
            UPDATE staff
            SET office_room_id = :rid,
                public_email = :pemail,
                official_profile_url = :purl,
                profile_visibility = :pvis
            WHERE staff_id = :sid
            """
        ),
        {
            "rid": payload.office_room_id,
            "pemail": validated_pub_email,
            "purl": profile_url,
            "pvis": payload.profile_visibility,
            "sid": staff_id,
        },
    )
    conn.commit()

    return {
        "updated": True,
        "staff_id": staff_id,
        "office_room_id": payload.office_room_id,
        "public_email": validated_pub_email,
        "official_profile_url": profile_url,
        "profile_visibility": payload.profile_visibility,
    }


@router.put("/availability")
def update_faculty_availability(
    payload: AvailabilityUpdateRequest,
    current_user: dict[str, Any] = Depends(require_roles("FACULTY", "ADMIN")),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    effective_roles = expand_effective_roles(current_user["roles"])
    is_admin = "ADMIN" in effective_roles

    target_staff_id = payload.staff_id if payload.staff_id is not None else current_user.get("linked_staff_id")
    if not target_staff_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No faculty profile is linked to this account.",
        )

    # Strict IDOR boundary: Non-admin faculty can ONLY update their own linked_staff_id
    if target_staff_id != current_user.get("linked_staff_id") and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Faculty members may only update their own availability status.",
        )

    staff_exists = conn.execute(
        text("SELECT 1 FROM staff WHERE staff_id = :sid LIMIT 1"),
        {"sid": target_staff_id},
    ).scalar()
    if not staff_exists:
        raise HTTPException(status_code=404, detail="Target faculty record not found.")

    source_type = (
        "FACULTY_SELF"
        if target_staff_id == current_user.get("linked_staff_id")
        else "DEPARTMENT_OFFICE"
    )
    res = conn.execute(
        text(
            """
            INSERT INTO faculty_availability
            (staff_id, availability_state, source_type, public_note, valid_from, valid_until, updated_by_user_id)
            VALUES (
                :sid,
                :st,
                :src,
                :note,
                CURRENT_TIMESTAMP,
                DATE_ADD(CURRENT_TIMESTAMP, INTERVAL :mins MINUTE),
                :uid
            )
            """
        ),
        {
            "sid": target_staff_id,
            "st": payload.availability_state,
            "src": source_type,
            "note": payload.public_note.strip() if payload.public_note else None,
            "mins": payload.valid_minutes,
            "uid": current_user["user_id"],
        },
    )
    avail_id = int(res.lastrowid)
    conn.execute(
        text(
            """
            INSERT INTO change_audit_log (user_id, action_type, table_name, record_id, new_value)
            VALUES (
                :uid, 'INSERT', 'faculty_availability', :aid,
                JSON_OBJECT('staff_id', :sid, 'availability_state', :st, 'valid_minutes', :mins)
            )
            """
        ),
        {
            "uid": current_user["user_id"],
            "aid": avail_id,
            "sid": target_staff_id,
            "st": payload.availability_state,
            "mins": payload.valid_minutes,
        },
    )
    conn.commit()

    saved_row = conn.execute(
        text(
            """
            SELECT last_updated_at, valid_until
            FROM faculty_availability
            WHERE availability_id = :aid
            """
        ),
        {"aid": avail_id},
    ).mappings().first()

    return {
        "availability_id": avail_id,
        "staff_id": target_staff_id,
        "availability_state": payload.availability_state,
        "source_type": source_type,
        "last_updated_at": saved_row["last_updated_at"].isoformat() if saved_row else None,
        "valid_until": saved_row["valid_until"].isoformat() if saved_row else None,
    }


@router.post("/mfa-sync")
def record_mfa_enrolment_state(
    current_user: dict[str, Any] = Depends(get_current_user),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    conn.execute(text("SET @current_app_user_id = :uid"), {"uid": current_user["user_id"]})
    conn.execute(
        text("UPDATE users SET mfa_enabled = TRUE WHERE user_id = :uid"),
        {"uid": current_user["user_id"]},
    )
    conn.commit()
    return {"mfa_enabled": True}


@router.post("/logout")
def logout_current_session(
    ctx: dict[str, Any] = Depends(get_verified_token_context),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    """Revokes the caller's current token JTI digest so it cannot be replayed."""
    claims = ctx["claims"]
    raw_token = ctx["raw_token"]
    user = ctx.get("user")
    jti = str(claims.get("jti") or raw_token)
    jti_digest = hash_jti(jti)
    exp_dt = datetime.fromtimestamp(int(claims["exp"]), tz=timezone.utc).replace(tzinfo=None)

    conn.execute(
        text(
            """
            INSERT IGNORE INTO revoked_token_jtis (jti_hash, user_id, expires_at)
            VALUES (:jh, :uid, :exp)
            """
        ),
        {"jh": jti_digest, "uid": user["user_id"] if user else None, "exp": exp_dt},
    )
    if user:
        conn.execute(
            text(
                """
                INSERT INTO change_audit_log (user_id, action_type, table_name, record_id, new_value)
                VALUES (:uid, 'AUTH_EVENT', 'users', :uid, JSON_OBJECT('event', 'LOGOUT_SESSION'))
                """
            ),
            {"uid": user["user_id"]},
        )
    conn.commit()
    return {"logged_out": True}


@router.post("/logout-all")
def logout_all_sessions(
    current_user: dict[str, Any] = Depends(get_current_user),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    """
    Invalidates ALL sessions issued at or before the current second by advancing
    `users.tokens_valid_after` + recording the current token JTI digest.
    """
    claims = current_user["_claims"]
    raw_token = current_user["_raw_token"]
    jti = str(claims.get("jti") or raw_token)
    exp_dt = datetime.fromtimestamp(int(claims["exp"]), tz=timezone.utc).replace(tzinfo=None)

    conn.execute(text("SET @current_app_user_id = :uid"), {"uid": current_user["user_id"]})
    conn.execute(
        text(
            """
            INSERT IGNORE INTO revoked_token_jtis (jti_hash, user_id, expires_at)
            VALUES (:jh, :uid, :exp)
            """
        ),
        {"jh": hash_jti(jti), "uid": current_user["user_id"], "exp": exp_dt},
    )
    conn.execute(
        text(
            """
            UPDATE users
            SET tokens_valid_after = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 SECOND)
            WHERE user_id = :uid
            """
        ),
        {"uid": current_user["user_id"]},
    )
    conn.execute(
        text(
            """
            INSERT INTO change_audit_log (user_id, action_type, table_name, record_id, new_value)
            VALUES (:uid, 'AUTH_EVENT', 'users', :uid, JSON_OBJECT('event', 'LOGOUT_ALL_SESSIONS'))
            """
        ),
        {"uid": current_user["user_id"]},
    )
    conn.commit()
    return {"logged_out_all_sessions": True}
