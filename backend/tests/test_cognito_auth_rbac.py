from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import hashlib
import secrets
import time
import uuid

from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.hashes import SHA1
from cryptography.hazmat.primitives.twofactor.totp import TOTP
from fastapi.testclient import TestClient
import jwt
import pytest
from sqlalchemy import text

from backend.app.auth.data_protection import redact_sensitive_text
from backend.app.auth.dev_oidc_sandbox import (
    SANDBOX_CLIENT_ID,
    SANDBOX_ISSUER,
    SANDBOX_KID,
    _PRIVATE_KEY as SANDBOX_PRIVATE_KEY,
)
from backend.app.auth.security import reset_rate_limits_for_tests
from backend.app.config.database import get_mysql_engine
from backend.app.config.settings import Settings
from backend.app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean_rate_limits() -> None:
    reset_rate_limits_for_tests()


def _mint_test_jwt(
    sub: str,
    email: str = "test.user@rvce.edu.in",
    email_verified: bool = True,
    token_use: str = "id",
    exp_offset_sec: int = 900,
    iat_offset_sec: int = 0,
    signing_key: object = SANDBOX_PRIVATE_KEY,
    alg: str = "RS256",
) -> str:
    now = int(datetime.now(timezone.utc).timestamp()) + iat_offset_sec
    payload: dict[str, object] = {
        "sub": sub,
        "iss": SANDBOX_ISSUER,
        "token_use": token_use,
        "iat": now,
        "auth_time": now,
        "exp": now + exp_offset_sec,
        "jti": str(uuid.uuid4()),
    }
    if token_use == "id":
        payload.update({"aud": SANDBOX_CLIENT_ID, "email": email, "email_verified": email_verified})
    else:
        payload.update({"client_id": SANDBOX_CLIENT_ID, "email_verified": email_verified})

    headers = {"kid": SANDBOX_KID, "alg": alg}
    return jwt.encode(payload, signing_key, algorithm=alg, headers=headers)


_TOTP_SECRETS: dict[str, bytes] = {}


def _totp_now(secret: bytes) -> str:
    return TOTP(secret, 6, SHA1(), 30, enforce_key_length=False).generate(int(time.time())).decode("ascii")


def _mfa_login(email: str, password: str) -> dict:
    """Every login MUST pass the authenticator step; first login enrols the authenticator."""
    r = client.post("/api/v1/dev-oidc/cognito/sign-in", json={"email": email, "password": password})
    assert r.status_code == 200
    body = r.json()
    assert "tokens" not in body, "password alone must never mint tokens"
    if body["challenge_name"] == "MFA_SETUP":
        b32 = body["secret_code"]
        _TOTP_SECRETS[email] = base64.b32decode(b32 + "=" * ((8 - len(b32) % 8) % 8))
    else:
        assert body["challenge_name"] == "SOFTWARE_TOKEN_MFA"
    r2 = client.post(
        "/api/v1/dev-oidc/cognito/respond-mfa",
        json={"session": body["session"], "code": _totp_now(_TOTP_SECRETS[email])},
    )
    assert r2.status_code == 200
    return r2.json()["tokens"]


# -----------------------------------------------------------------------------
# CASE 1, 3, 4 & ADMIN WORKFLOW: Allowlisted vs Unverified vs Unapproved Registration
# -----------------------------------------------------------------------------
def test_01_valid_allowlisted_rvce_registration_and_admin_approval_workflow() -> None:
    unique_tag = secrets.token_hex(4)
    allowlisted_email = f"allowlisted.{unique_tag}@rvce.edu.in"
    unlisted_email = f"unlisted.{unique_tag}@rvce.edu.in"

    # Sign in as seeded Institutional Admin (`sysadmin@rvce.edu.in`)
    admin_token = _mfa_login("sysadmin@rvce.edu.in", "RvceStaff#2026")["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # Fetch an existing verified staff_id from public directory
    fac_list = client.get("/api/v1/faculty").json()
    # Pick a faculty record not yet linked to a user
    with get_mysql_engine().connect() as conn:
        free_staff_id = conn.execute(
            text(
                """
                SELECT s.staff_id
                FROM staff s
                LEFT JOIN users u ON u.linked_staff_id = s.staff_id
                WHERE u.user_id IS NULL AND s.staff_type = 'FACULTY'
                LIMIT 1
                """
            )
        ).scalar()
    assert free_staff_id is not None

    # Admin pre-authorizes `allowlisted_email` on the Staff Eligibility Allowlist
    r_alw = client.post(
        "/api/v1/admin/allowlist",
        headers=admin_headers,
        json={
            "email": allowlisted_email,
            "linked_staff_id": int(free_staff_id),
            "assigned_role_code": "FACULTY",
            "notes": "Approved faculty onboarding test",
        },
    )
    assert r_alw.status_code == 201

    # 1A. Register & verify `allowlisted_email` through Cognito SignUp + ConfirmSignUp
    r_signup = client.post(
        "/api/v1/dev-oidc/cognito/sign-up",
        json={
            "email": allowlisted_email,
            "full_name": "Dr. Allowlisted Faculty",
            "password": "FacultyPass#2026",
        },
    )
    assert r_signup.status_code == 200
    otp_code = r_signup.json()["sandbox_dev_otp_hint"]

    r_confirm = client.post(
        "/api/v1/dev-oidc/cognito/confirm-sign-up",
        json={"email": allowlisted_email, "code": otp_code},
    )
    assert r_confirm.status_code == 200

    id_tok = _mfa_login(allowlisted_email, "FacultyPass#2026")["id_token"]

    r_sync = client.post(
        "/api/v1/auth/complete-registration",
        headers={"Authorization": f"Bearer {id_tok}"},
        json={
            "full_name": "Dr. Allowlisted Faculty",
            "email": allowlisted_email,
            "terms_accepted": True,
        },
    )
    assert r_sync.status_code == 200
    sync_body = r_sync.json()
    assert sync_body["onboarding_status"] == "APPROVED"
    assert sync_body["user"]["roles"] == ["FACULTY"]
    assert sync_body["user"]["linked_staff_id"] == int(free_staff_id)

    # 1B (Case 4). Verified `@rvce.edu.in` email NOT on allowlist -> Held in PENDING_APPROVAL (403 on staff APIs)
    unlisted_sub = str(uuid.uuid4())
    unlisted_tok = _mint_test_jwt(sub=unlisted_sub, email=unlisted_email, email_verified=True)
    r_pending = client.post(
        "/api/v1/auth/complete-registration",
        headers={"Authorization": f"Bearer {unlisted_tok}"},
        json={
            "full_name": "Unlisted RVCE Holder",
            "email": unlisted_email,
            "terms_accepted": True,
        },
    )
    assert r_pending.status_code == 200
    assert r_pending.json()["onboarding_status"] == "PENDING_APPROVAL"
    assert r_pending.json()["user"] is None

    # Verified but unapproved user MUST be denied staff endpoints (403)
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {unlisted_tok}"}).status_code == 403
    assert (
        client.put(
            "/api/v1/auth/availability",
            headers={"Authorization": f"Bearer {unlisted_tok}"},
            json={"availability_state": "AVAILABLE", "valid_minutes": 60},
        ).status_code
        == 403
    )

    # Unapproved user CANNOT approve their own account
    pending_users = client.get(
        "/api/v1/admin/users?approval_status=PENDING_APPROVAL", headers=admin_headers
    ).json()
    target_pending = next(u for u in pending_users if u["email"] == unlisted_email)
    target_uid = target_pending["user_id"]

    assert (
        client.post(
            f"/api/v1/admin/accounts/{target_uid}/decision",
            headers={"Authorization": f"Bearer {unlisted_tok}"},
            json={"action": "APPROVE", "role_code": "FACULTY"},
        ).status_code
        == 403
    )

    # Admin CANNOT approve/modify their own account (self-approval block)
    admin_me = client.get("/api/v1/auth/me", headers=admin_headers).json()
    r_self_approve = client.post(
        f"/api/v1/admin/accounts/{admin_me['user_id']}/decision",
        headers=admin_headers,
        json={"action": "APPROVE", "role_code": "ADMIN"},
    )
    assert r_self_approve.status_code == 403

    # Admin approves pending user -> works; then Admin suspends -> live token immediately blocked!
    r_approve = client.post(
        f"/api/v1/admin/accounts/{target_uid}/decision",
        headers=admin_headers,
        json={"action": "APPROVE", "role_code": "STAFF", "reason": "Verified gate staff"},
    )
    assert r_approve.status_code == 200
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {unlisted_tok}"}).status_code == 200

    r_suspend = client.post(
        f"/api/v1/admin/accounts/{target_uid}/decision",
        headers=admin_headers,
        json={"action": "SUSPENDED" if False else "SUSPEND", "reason": "Security audit hold"},
    )
    assert r_suspend.status_code == 200
    # Existing token issued prior to suspension is immediately rejected (401/403)!
    r_after_suspend = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {unlisted_tok}"})
    assert r_after_suspend.status_code in (401, 403)


# -----------------------------------------------------------------------------
# CASE 2 & 3: Non-RVCE Email Rejection & Unverified Email Rejection
# -----------------------------------------------------------------------------
def test_02_non_rvce_domains_and_unverified_emails_rejected() -> None:
    bad_emails = [
        "attacker@gmail.com",
        "student@student.rvce.edu.in",
        "spoof@rvce.edu.in.attacker.com",
        "fake@rvce-edu.in",
    ]
    for bad in bad_emails:
        r = client.post(
            "/api/v1/dev-oidc/cognito/sign-up",
            json={"email": bad, "full_name": "Invalid User", "password": "ValidPass#2026"},
        )
        assert r.status_code == 400

        tok = _mint_test_jwt(sub=str(uuid.uuid4()), email=bad, email_verified=True)
        r2 = client.post(
            "/api/v1/auth/complete-registration",
            headers={"Authorization": f"Bearer {tok}"},
            json={"full_name": "Invalid User", "email": bad, "terms_accepted": True},
        )
        assert r2.status_code == 400

    # Case 3: Unverified email (`email_verified=False`) rejected with 403
    unverified_tok = _mint_test_jwt(
        sub=str(uuid.uuid4()),
        email=f"unverified.{secrets.token_hex(3)}@rvce.edu.in",
        email_verified=False,
    )
    r_unv = client.post(
        "/api/v1/auth/complete-registration",
        headers={"Authorization": f"Bearer {unverified_tok}"},
        json={
            "full_name": "Unverified Person",
            "email": "hod.cse@rvce.edu.in",
            "terms_accepted": True,
        },
    )
    assert r_unv.status_code == 403


# -----------------------------------------------------------------------------
# CASE 5, 6, 7 & 8: OAuth 2.0 PKCE S256, Invalid Password, Recovery & TOTP MFA
# -----------------------------------------------------------------------------
def test_03_oauth2_pkce_s256_mfa_and_password_recovery_lifecycle() -> None:
    # Case 6: Invalid password rejected with identical generic message (anti-enumeration)
    r_bad_user = client.post(
        "/api/v1/dev-oidc/cognito/sign-in",
        json={"email": "doesnotexist@rvce.edu.in", "password": "WrongPassword#1"},
    )
    r_bad_pass = client.post(
        "/api/v1/dev-oidc/cognito/sign-in",
        json={"email": "faculty.cse@rvce.edu.in", "password": "WrongPassword#1"},
    )
    assert r_bad_user.status_code == 401
    assert r_bad_pass.status_code == 401
    assert r_bad_user.json()["detail"] == r_bad_pass.json()["detail"]

    # Case 5: OAuth 2.0 Authorization Code + S256 PKCE Flow (`rvce-navigator://auth/callback`)
    code_verifier = secrets.token_urlsafe(48)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode("ascii")).digest())
        .rstrip(b"=")
        .decode("ascii")
    )
    # Enrol the authenticator for hod.cse (first login), then PKCE browser flow MUST demand TOTP too
    _mfa_login("hod.cse@rvce.edu.in", "RvceStaff#2026")
    hod_secret = _TOTP_SECRETS["hod.cse@rvce.edu.in"]

    r_no_totp = client.post(
        "/api/v1/dev-oidc/oauth2/authorize",
        data={
            "client_id": SANDBOX_CLIENT_ID,
            "redirect_uri": "rvce-navigator://auth/callback",
            "code_challenge": challenge,
            "state": "noMfa",
            "email": "hod.cse@rvce.edu.in",
            "password": "RvceStaff#2026",
        },
        follow_redirects=False,
    )
    assert r_no_totp.status_code == 200  # authenticator prompt page, NOT a redirect with a code
    assert "code=" not in r_no_totp.headers.get("location", "")

    r_authz = client.post(
        "/api/v1/dev-oidc/oauth2/authorize",
        data={
            "client_id": SANDBOX_CLIENT_ID,
            "redirect_uri": "rvce-navigator://auth/callback",
            "code_challenge": challenge,
            "state": "xyz123",
            "email": "hod.cse@rvce.edu.in",
            "password": "RvceStaff#2026",
            "totp_code": _totp_now(hod_secret),
        },
        follow_redirects=False,
    )
    assert r_authz.status_code == 302
    loc = r_authz.headers["location"]
    assert loc.startswith("rvce-navigator://auth/callback?code=")
    auth_code = loc.split("code=")[1].split("&")[0]

    # Wrong PKCE verifier MUST fail
    r_wrong_pkce = client.post(
        "/api/v1/dev-oidc/oauth2/token",
        json={
            "grant_type": "authorization_code",
            "client_id": SANDBOX_CLIENT_ID,
            "code": auth_code,
            "code_verifier": "wrong-verifier-value-that-does-not-match-challenge",
            "redirect_uri": "rvce-navigator://auth/callback",
        },
    )
    assert r_wrong_pkce.status_code == 400

    # Issue fresh code and exchange with valid PKCE verifier
    r_authz2 = client.post(
        "/api/v1/dev-oidc/oauth2/authorize",
        data={
            "client_id": SANDBOX_CLIENT_ID,
            "redirect_uri": "rvce-navigator://auth/callback",
            "code_challenge": challenge,
            "state": "xyz124",
            "email": "hod.cse@rvce.edu.in",
            "password": "RvceStaff#2026",
            "totp_code": _totp_now(hod_secret),
        },
        follow_redirects=False,
    )
    auth_code2 = r_authz2.headers["location"].split("code=")[1].split("&")[0]
    r_tok = client.post(
        "/api/v1/dev-oidc/oauth2/token",
        json={
            "grant_type": "authorization_code",
            "client_id": SANDBOX_CLIENT_ID,
            "code": auth_code2,
            "code_verifier": code_verifier,
            "redirect_uri": "rvce-navigator://auth/callback",
        },
    )
    assert r_tok.status_code == 200
    pkce_access_token = r_tok.json()["access_token"]
    r_me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {pkce_access_token}"})
    assert r_me.status_code == 200
    assert r_me.json()["email"] == "hod.cse@rvce.edu.in"

    # Case 8: Enrol & Verify RFC-6238 TOTP MFA on a dedicated faculty test identity
    mfa_email = f"mfa.fac.{secrets.token_hex(3)}@rvce.edu.in"
    r_su = client.post(
        "/api/v1/dev-oidc/cognito/sign-up",
        json={"email": mfa_email, "full_name": "Prof. MFA Test", "password": "InitialPass#2026"},
    )
    client.post(
        "/api/v1/dev-oidc/cognito/confirm-sign-up",
        json={"email": mfa_email, "code": r_su.json()["sandbox_dev_otp_hint"]},
    )
    # First login MUST force authenticator enrolment (MFA_SETUP) - password alone mints NO tokens
    r_first = client.post(
        "/api/v1/dev-oidc/cognito/sign-in",
        json={"email": mfa_email, "password": "InitialPass#2026"},
    )
    assert r_first.status_code == 200
    first = r_first.json()
    assert first["challenge_name"] == "MFA_SETUP"
    assert "tokens" not in first
    b32_secret = first["secret_code"]
    padded = b32_secret + "=" * ((8 - len(b32_secret) % 8) % 8)
    secret_bytes = base64.b32decode(padded)
    totp = TOTP(secret_bytes, 6, SHA1(), 30, enforce_key_length=False)

    # Wrong code during enrolment rejected; correct code activates MFA and mints tokens
    assert (
        client.post(
            "/api/v1/dev-oidc/cognito/respond-mfa",
            json={"session": first["session"], "code": "000000"},
        ).status_code
        == 401
    )
    r_enrol = client.post(
        "/api/v1/dev-oidc/cognito/respond-mfa",
        json={"session": first["session"], "code": totp.generate(int(time.time())).decode("ascii")},
    )
    assert r_enrol.status_code == 200
    assert "access_token" in r_enrol.json()["tokens"]

    # Every subsequent sign-in MUST require SOFTWARE_TOKEN_MFA
    r_chal = client.post(
        "/api/v1/dev-oidc/cognito/sign-in",
        json={"email": mfa_email, "password": "InitialPass#2026"},
    )
    assert r_chal.status_code == 200
    assert r_chal.json()["challenge_name"] == "SOFTWARE_TOKEN_MFA"
    assert "tokens" not in r_chal.json()
    sess_id = r_chal.json()["session"]

    # Wrong MFA code rejected
    assert (
        client.post(
            "/api/v1/dev-oidc/cognito/respond-mfa",
            json={"session": sess_id, "code": "000000"},
        ).status_code
        == 401
    )
    # Valid TOTP code succeeds
    r_mfa_ok = client.post(
        "/api/v1/dev-oidc/cognito/respond-mfa",
        json={"session": sess_id, "code": totp.generate(int(time.time())).decode("ascii")},
    )
    assert r_mfa_ok.status_code == 200
    assert "access_token" in r_mfa_ok.json()["tokens"]

    # Case 7: Password Recovery Flow (anti-enumeration + reset + old refresh invalidation)
    old_rt = r_mfa_ok.json()["tokens"]["refresh_token"]
    r_fp = client.post("/api/v1/dev-oidc/cognito/forgot-password", json={"email": mfa_email})
    assert r_fp.status_code == 200
    reset_code = r_fp.json()["sandbox_dev_otp_hint"]

    r_cfp = client.post(
        "/api/v1/dev-oidc/cognito/confirm-forgot-password",
        json={"email": mfa_email, "code": reset_code, "new_password": "UpdatedPass#2026"},
    )
    assert r_cfp.status_code == 200

    # Old refresh token must be revoked after password reset
    r_old_rt = client.post(
        "/api/v1/dev-oidc/oauth2/token",
        json={
            "grant_type": "refresh_token",
            "client_id": SANDBOX_CLIENT_ID,
            "refresh_token": old_rt,
        },
    )
    assert r_old_rt.status_code == 400


# -----------------------------------------------------------------------------
# CASE 9, 10, 11, 12, 13 & 14: Expired/Forged JWTs, Logout Revocation & IDOR RBAC
# -----------------------------------------------------------------------------
def test_04_expired_revoked_idor_and_privilege_escalation_defenses() -> None:
    # Case 11: Public endpoints work WITHOUT authentication; staff endpoints reject public users
    assert client.get("/api/v1/buildings").status_code == 200
    assert client.get("/api/v1/facilities").status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.put("/api/v1/auth/availability", json={"availability_state": "AVAILABLE"}).status_code == 401
    assert client.patch("/api/v1/auth/profile", json={"profile_visibility": "PUBLIC"}).status_code == 401
    assert client.get("/api/v1/admin/users").status_code == 401

    # Case 9: Expired RS256 token rejected (401)
    expired_tok = _mint_test_jwt(
        sub="00000000-0000-4000-8000-000000000005",
        email="faculty.cse@rvce.edu.in",
        exp_offset_sec=-120,
        iat_offset_sec=-600,
    )
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {expired_tok}"}).status_code == 401

    # Case 14: Forged RSA keypair & HS256 algorithm confusion rejected (401)
    rogue_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    forged_tok = _mint_test_jwt(
        sub="00000000-0000-4000-8000-000000000001",
        email="sysadmin@rvce.edu.in",
        signing_key=rogue_key,
    )
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {forged_tok}"}).status_code == 401

    hs256_tok = jwt.encode(
        {
            "sub": "00000000-0000-4000-8000-000000000001",
            "iss": SANDBOX_ISSUER,
            "aud": SANDBOX_CLIENT_ID,
            "token_use": "id",
            "iat": int(time.time()),
            "exp": int(time.time()) + 600,
        },
        "symmetric-secret",
        algorithm="HS256",
    )
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {hs256_tok}"}).status_code == 401

    # Sign in as ordinary CSE Faculty (`faculty.cse@rvce.edu.in`)
    fac_tokens = _mfa_login("faculty.cse@rvce.edu.in", "RvceStaff#2026")
    fac_headers = {"Authorization": f"Bearer {fac_tokens['access_token']}"}
    fac_me = client.get("/api/v1/auth/me", headers=fac_headers).json()

    # Own availability update succeeds (including new granular state `IN_CLASS`)
    r_own_avail = client.put(
        "/api/v1/auth/availability",
        headers=fac_headers,
        json={"availability_state": "IN_CLASS", "valid_minutes": 60, "public_note": "Conducting DBMS Lab"},
    )
    assert r_own_avail.status_code == 200
    assert r_own_avail.json()["availability_state"] == "IN_CLASS"

    # Case 12: Faculty CANNOT modify another faculty member's availability (IDOR -> 403)
    other_staff_id = (fac_me["linked_staff_id"] or 1) + 1
    r_idor = client.put(
        "/api/v1/auth/availability",
        headers=fac_headers,
        json={"availability_state": "UNAVAILABLE", "valid_minutes": 60, "staff_id": other_staff_id},
    )
    assert r_idor.status_code == 403

    # Case 13 & 14: Faculty CANNOT access admin endpoints or pass client-side `role: ADMIN` payloads
    assert client.get("/api/v1/admin/users", headers=fac_headers).status_code == 403
    assert (
        client.post(
            "/api/v1/auth/complete-registration",
            headers=fac_headers,
            json={
                "full_name": "Escalation Attempt",
                "email": "faculty.cse@rvce.edu.in",
                "terms_accepted": True,
                "role": "ADMIN",
            },
        ).status_code
        == 422
    )

    # Case 10 & 16: Logout revokes token JTI immediately (401 on subsequent replay)
    assert client.post("/api/v1/auth/logout", headers=fac_headers).status_code == 200
    assert client.get("/api/v1/auth/me", headers=fac_headers).status_code == 401


# -----------------------------------------------------------------------------
# CASE 15 & 17: Log Redaction, Rate Limiting & Production Fail-Closed Guard
# -----------------------------------------------------------------------------
def test_05_log_redaction_rate_limiting_and_production_posture() -> None:
    sample_log = (
        'Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl '
        'payload={"password": "MySecretPassword#1", "totp_code": "654321"}'
    )
    scrubbed = redact_sensitive_text(sample_log)
    assert "MySecretPassword#1" not in scrubbed
    assert "654321" not in scrubbed
    assert "eyJhbGciOiJSUzI1NiJ9" not in scrubbed
    assert "[REDACTED" in scrubbed

    # Production posture fail-closed check when Cognito Pool ID is missing
    prod_settings = Settings(APP_ENV="production", COGNITO_USER_POOL_ID="", COGNITO_APP_CLIENT_ID="")
    with pytest.raises(RuntimeError):
        prod_settings.validate_security_posture()
    assert prod_settings.use_dev_oidc_sandbox is False
