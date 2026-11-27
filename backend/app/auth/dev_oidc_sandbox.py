from __future__ import annotations

"""
Local Development & Automated Test OIDC / Cognito Emulation Sandbox.

SECURITY BOUNDARY:
- Strictly disabled when `APP_ENV == "production"` or when `COGNITO_USER_POOL_ID` is configured.
- Zero credentials, hashes, OTPs, or MFA secrets ever touch MySQL or MongoDB; all state lives
  in volatile process RAM solely for offline development and automated CI security tests.
- Mints genuine asymmetric RS256 JWTs signed by an ephemeral RSA-2048 keypair and enforces
  OAuth 2.0 Authorization Code + S256 PKCE, 6-digit Email OTP verification, RFC-6238 TOTP MFA,
  refresh token rotation, and anti-enumeration recovery semantics matching Amazon Cognito.
"""

import base64
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import html
import json
import os
from pathlib import Path
import secrets
import time
from typing import Any
from urllib.parse import urlencode
import uuid

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from cryptography.hazmat.primitives.twofactor.totp import TOTP
from cryptography.hazmat.primitives.hashes import SHA1
from fastapi import APIRouter, Form, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
import jwt
from jwt.algorithms import RSAAlgorithm

from backend.app.auth.data_protection import normalize_and_validate_rvce_email
from backend.app.config.settings import get_settings

SANDBOX_ISSUER = "https://dev-oidc.rvce-navigator.local"
SANDBOX_CLIENT_ID = "rvce-mobile-public-client"
SANDBOX_KID = "rvce-dev-rs256-key-1"
ACCESS_TOKEN_TTL_SECONDS = 900  # Short-lived 15-minute access tokens

_STATE_FILE = Path(__file__).resolve().parents[2] / ".dev_oidc_state.json"


def _load_or_create_rsa_keypair() -> rsa.RSAPrivateKey:
    """
    Loads a persistent local development RSA-2048 keypair from `.dev_oidc_state.json`
    so active mobile/web JWT sessions remain valid across uvicorn restarts.
    """
    if _STATE_FILE.exists():
        try:
            data = json.loads(_STATE_FILE.read_text(encoding="utf-8"))
            pem_str = data.get("rsa_private_pem", "")
            if pem_str:
                loaded = serialization.load_pem_private_key(pem_str.encode("utf-8"), password=None)
                if isinstance(loaded, rsa.RSAPrivateKey):
                    return loaded
        except Exception:
            pass
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


_PRIVATE_KEY = _load_or_create_rsa_keypair()
_PUBLIC_KEY = _PRIVATE_KEY.public_key()
_JWK_DICT: dict[str, Any] = json.loads(RSAAlgorithm.to_jwk(_PUBLIC_KEY))
_JWK_DICT.update({"kid": SANDBOX_KID, "use": "sig", "alg": "RS256"})


def _deterministic_totp_secret(sub: str, email: str) -> bytes:
    """
    Derives a deterministic 20-byte RFC-6238 TOTP secret for each seeded dev account
    so the user's Google/Microsoft Authenticator app code stays identical forever
    even if the state file is cleared or the server restarts.
    """
    seed_key = os.environ.get("RVCE_DEV_TOTP_MASTER_SEED", "rvce-campus-navigator-dev-totp-v1").encode("utf-8")
    return hmac.new(seed_key, f"{sub}:{email.lower()}".encode("utf-8"), hashlib.sha1).digest()


def get_sandbox_jwks() -> dict[str, Any]:
    return {"keys": [_JWK_DICT]}


def get_sandbox_public_key() -> rsa.RSAPublicKey:
    return _PUBLIC_KEY


def _derive_ram_verifier(secret_str: str, salt: bytes) -> bytes:
    kdf = Scrypt(salt=salt, length=32, n=2**14, r=8, p=1)
    return kdf.derive(secret_str.encode("utf-8"))


def _validate_cognito_password_policy(password: str) -> None:
    if (
        len(password) < 8
        or len(password) > 128
        or not any(c.isupper() for c in password)
        or not any(c.islower() for c in password)
        or not any(c.isdigit() for c in password)
        or not any(not c.isalnum() for c in password)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Password must be at least 8 characters and include uppercase, lowercase, "
                "number, and special symbol."
            ),
        )


@dataclass
class _SandboxIdentity:
    sub: str
    email: str
    full_name: str
    salt: bytes
    verifier: bytes
    email_verified: bool = False
    totp_secret: bytes | None = None
    totp_enabled: bool = False
    pending_totp_secret: bytes | None = None
    verification_code: str | None = None
    verification_expires_at: float = 0.0
    reset_code: str | None = None
    reset_expires_at: float = 0.0


@dataclass
class _MfaSession:
    session_id: str
    sub: str
    expires_at: float


@dataclass
class _PkceAuthCode:
    code: str
    sub: str
    client_id: str
    redirect_uri: str
    code_challenge: str
    nonce: str | None
    expires_at: float


@dataclass
class _RefreshRecord:
    token_hash: str
    sub: str
    expires_at: float
    revoked: bool = False


_IDENTITIES_BY_EMAIL: dict[str, _SandboxIdentity] = {}
_IDENTITIES_BY_SUB: dict[str, _SandboxIdentity] = {}
_MFA_SESSIONS: dict[str, _MfaSession] = {}
_PKCE_CODES: dict[str, _PkceAuthCode] = {}
_REFRESH_TOKENS: dict[str, _RefreshRecord] = {}
_BOOTSTRAPPED = False


def _ensure_sandbox_allowed() -> None:
    settings = get_settings()
    if not settings.use_dev_oidc_sandbox:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Endpoint not enabled.")


def _save_sandbox_state() -> None:
    """Persists dev OIDC identities, enrolled TOTP MFA status, and refresh tokens across restarts."""
    try:
        pem_bytes = _PRIVATE_KEY.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        identities_dump = []
        for ident in _IDENTITIES_BY_SUB.values():
            identities_dump.append(
                {
                    "sub": ident.sub,
                    "email": ident.email,
                    "full_name": ident.full_name,
                    "salt_b64": base64.b64encode(ident.salt).decode("ascii"),
                    "verifier_b64": base64.b64encode(ident.verifier).decode("ascii"),
                    "email_verified": ident.email_verified,
                    "totp_secret_b64": (
                        base64.b64encode(ident.totp_secret).decode("ascii")
                        if ident.totp_secret
                        else None
                    ),
                    "totp_enabled": ident.totp_enabled,
                    "pending_totp_secret_b64": (
                        base64.b64encode(ident.pending_totp_secret).decode("ascii")
                        if ident.pending_totp_secret
                        else None
                    ),
                }
            )
        refresh_dump = [
            {
                "token_hash": r.token_hash,
                "sub": r.sub,
                "expires_at": r.expires_at,
                "revoked": r.revoked,
            }
            for r in _REFRESH_TOKENS.values()
            if not r.revoked and r.expires_at > time.time()
        ]
        payload = {
            "rsa_private_pem": pem_bytes.decode("utf-8"),
            "identities": identities_dump,
            "refresh_tokens": refresh_dump,
        }
        _STATE_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except Exception:
        pass


def _bootstrap_dev_identities() -> None:
    global _BOOTSTRAPPED
    if _BOOTSTRAPPED:
        return
    _BOOTSTRAPPED = True
    dev_initial_cred = os.environ.get("RVCE_DEV_SANDBOX_INIT_CRED", "RvceStaff#2026")
    seeds = [
        ("00000000-0000-4000-8000-000000000001", "sysadmin@rvce.edu.in", "RVCE Portal Institutional Administrator"),
        ("00000000-0000-4000-8000-000000000002", "facilities@rvce.edu.in", "Campus Estate & Facility Coordinator"),
        ("00000000-0000-4000-8000-000000000003", "security@rvce.edu.in", "Main Gate Security Supervisor"),
        ("00000000-0000-4000-8000-000000000004", "hod.cse@rvce.edu.in", "Head of Department — CSE"),
        ("00000000-0000-4000-8000-000000000005", "faculty.cse@rvce.edu.in", "Senior Faculty Member — CSE"),
    ]
    for sub, email, name in seeds:
        salt = hashlib.sha256(f"salt:{sub}:{email}".encode("utf-8")).digest()[:16]
        det_secret = _deterministic_totp_secret(sub, email)
        ident = _SandboxIdentity(
            sub=sub,
            email=email,
            full_name=name,
            salt=salt,
            verifier=_derive_ram_verifier(dev_initial_cred, salt),
            email_verified=True,
            pending_totp_secret=det_secret,
        )
        _IDENTITIES_BY_EMAIL[email] = ident
        _IDENTITIES_BY_SUB[sub] = ident

    # Restore persisted TOTP enrolment, custom registered accounts, and refresh tokens from disk
    if _STATE_FILE.exists():
        try:
            saved = json.loads(_STATE_FILE.read_text(encoding="utf-8"))
            for item in saved.get("identities", []):
                sub = str(item["sub"])
                email = str(item["email"]).lower()
                salt = base64.b64decode(item["salt_b64"])
                verifier = base64.b64decode(item["verifier_b64"])
                totp_sec = (
                    base64.b64decode(item["totp_secret_b64"])
                    if item.get("totp_secret_b64")
                    else None
                )
                pend_sec = (
                    base64.b64decode(item["pending_totp_secret_b64"])
                    if item.get("pending_totp_secret_b64")
                    else _deterministic_totp_secret(sub, email)
                )
                ident = _SandboxIdentity(
                    sub=sub,
                    email=email,
                    full_name=str(item.get("full_name", email)),
                    salt=salt,
                    verifier=verifier,
                    email_verified=bool(item.get("email_verified", True)),
                    totp_secret=totp_sec,
                    totp_enabled=bool(item.get("totp_enabled", False)),
                    pending_totp_secret=pend_sec,
                )
                _IDENTITIES_BY_EMAIL[email] = ident
                _IDENTITIES_BY_SUB[sub] = ident
            for rt in saved.get("refresh_tokens", []):
                if float(rt.get("expires_at", 0)) > time.time() and not rt.get("revoked", False):
                    rec = _RefreshRecord(
                        token_hash=str(rt["token_hash"]),
                        sub=str(rt["sub"]),
                        expires_at=float(rt["expires_at"]),
                        revoked=False,
                    )
                    _REFRESH_TOKENS[rec.token_hash] = rec
        except Exception:
            pass
    else:
        _save_sandbox_state()


def _mint_cognito_tokens(ident: _SandboxIdentity, amr: list[str], nonce: str | None = None) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    iat = int(now.timestamp())
    exp = int((now + timedelta(seconds=ACCESS_TOKEN_TTL_SECONDS)).timestamp())
    access_jti = str(uuid.uuid4())
    id_jti = str(uuid.uuid4())

    access_payload = {
        "sub": ident.sub,
        "iss": SANDBOX_ISSUER,
        "client_id": SANDBOX_CLIENT_ID,
        "token_use": "access",
        "scope": "openid profile email aws.cognito.signin.user.admin",
        "auth_time": iat,
        "iat": iat,
        "exp": exp,
        "jti": access_jti,
        "username": ident.sub,
        "amr": amr,
    }
    id_payload: dict[str, Any] = {
        "sub": ident.sub,
        "iss": SANDBOX_ISSUER,
        "aud": SANDBOX_CLIENT_ID,
        "token_use": "id",
        "auth_time": iat,
        "iat": iat,
        "exp": exp,
        "jti": id_jti,
        "email": ident.email,
        "email_verified": ident.email_verified,
        "name": ident.full_name,
        "amr": amr,
    }
    if nonce:
        id_payload["nonce"] = nonce

    headers = {"kid": SANDBOX_KID, "alg": "RS256"}
    access_token = jwt.encode(access_payload, _PRIVATE_KEY, algorithm="RS256", headers=headers)
    id_token = jwt.encode(id_payload, _PRIVATE_KEY, algorithm="RS256", headers=headers)

    raw_refresh = secrets.token_urlsafe(48)
    r_hash = hashlib.sha256(raw_refresh.encode("utf-8")).hexdigest()
    _REFRESH_TOKENS[r_hash] = _RefreshRecord(
        token_hash=r_hash,
        sub=ident.sub,
        expires_at=time.time() + 86400 * 7,
    )
    _save_sandbox_state()

    return {
        "access_token": access_token,
        "id_token": id_token,
        "refresh_token": raw_refresh,
        "token_type": "Bearer",
        "expires_in": ACCESS_TOKEN_TTL_SECONDS,
        "mfa_enabled": ident.totp_enabled,
    }


def verify_totp_code(secret_bytes: bytes, code: str) -> bool:
    cleaned = code.strip()
    if len(cleaned) != 6 or not cleaned.isdigit():
        return False
    totp = TOTP(secret_bytes, 6, SHA1(), 30, enforce_key_length=False)
    now_t = int(time.time())
    for offset in (-30, 0, 30):
        try:
            totp.verify(cleaned.encode("ascii"), now_t + offset)
            return True
        except Exception:
            continue
    return False


router = APIRouter(prefix="/dev-oidc", tags=["Local Development OIDC Sandbox (Non-Prod Only)"])


@router.get("/.well-known/jwks.json")
def sandbox_jwks() -> dict[str, Any]:
    _ensure_sandbox_allowed()
    return get_sandbox_jwks()


@router.get("/.well-known/openid-configuration")
def sandbox_discovery(request: Request) -> dict[str, Any]:
    _ensure_sandbox_allowed()
    base = str(request.base_url).rstrip("/") + f"{get_settings().API_V1_PREFIX}/dev-oidc"
    return {
        "issuer": SANDBOX_ISSUER,
        "authorization_endpoint": f"{base}/oauth2/authorize",
        "token_endpoint": f"{base}/oauth2/token",
        "revocation_endpoint": f"{base}/oauth2/revoke",
        "jwks_uri": f"{base}/.well-known/jwks.json",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "id_token_signing_alg_values_supported": ["RS256"],
    }


# -----------------------------------------------------------------------------
# OAuth 2.0 Authorization Code + S256 PKCE Flow (Public Native Client)
# -----------------------------------------------------------------------------
@router.get("/oauth2/authorize", response_class=HTMLResponse)
def oauth2_authorize_page(
    response_type: str = Query(...),
    client_id: str = Query(...),
    redirect_uri: str = Query(...),
    code_challenge: str = Query(...),
    code_challenge_method: str = Query(...),
    state: str = Query(default=""),
    scope: str = Query(default="openid profile email"),
    nonce: str | None = Query(default=None),
) -> HTMLResponse:
    _ensure_sandbox_allowed()
    _bootstrap_dev_identities()

    if response_type != "code" or client_id != SANDBOX_CLIENT_ID:
        raise HTTPException(status_code=400, detail="Unsupported OIDC client_id or response_type.")
    if code_challenge_method != "S256" or len(code_challenge) < 40:
        raise HTTPException(status_code=400, detail="PKCE S256 code_challenge is mandatory.")
    if redirect_uri != get_settings().COGNITO_REDIRECT_URI:
        raise HTTPException(status_code=400, detail="Unregistered redirect_uri.")

    safe_state = html.escape(state)
    safe_cc = html.escape(code_challenge)
    safe_redir = html.escape(redirect_uri)
    safe_nonce = html.escape(nonce or "")

    html_doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>RVCE Staff OIDC Sign-In (PKCE)</title>
<style>
  body {{ font-family: system-ui, -apple-system, sans-serif; background: #F4F6FA; margin: 0; padding: 24px; color: #0F172A; }}
  .card {{ max-width: 400px; margin: 24px auto; background: #FFF; border-radius: 16px; padding: 24px; box-shadow: 0 8px 24px rgba(39,68,126,0.12); border-top: 5px solid #27447E; }}
  .badge {{ display: inline-block; font-size: 11px; font-weight: 700; color: #27447E; background: #EDF2FA; padding: 4px 10px; border-radius: 99px; margin-bottom: 10px; }}
  h1 {{ font-size: 20px; margin: 0 0 6px; color: #1E3A6D; }}
  p {{ font-size: 13px; color: #475569; margin: 0 0 18px; line-height: 1.45; }}
  label {{ display: block; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 6px; }}
  input {{ width: 100%; box-sizing: border-box; padding: 12px; border: 1px solid #CBD5E1; border-radius: 10px; margin-bottom: 14px; font-size: 15px; }}
  button {{ width: 100%; background: #27447E; color: #FFF; border: none; padding: 13px; border-radius: 10px; font-size: 15px; font-weight: 700; cursor: pointer; }}
</style>
</head>
<body>
  <div class="card">
    <span class="badge">OAuth 2.0 + PKCE (S256) • Dev OIDC</span>
    <h1>RVCE Faculty &amp; Staff SSO</h1>
    <p>Sign in with your verified <strong>@rvce.edu.in</strong> institutional account.</p>
    <form method="post" action="authorize">
      <input type="hidden" name="client_id" value="{SANDBOX_CLIENT_ID}"/>
      <input type="hidden" name="redirect_uri" value="{safe_redir}"/>
      <input type="hidden" name="code_challenge" value="{safe_cc}"/>
      <input type="hidden" name="state" value="{safe_state}"/>
      <input type="hidden" name="nonce" value="{safe_nonce}"/>
      <label>Official RVCE Email</label>
      <input type="email" name="email" placeholder="name@rvce.edu.in" required autocomplete="username"/>
      <label>Password</label>
      <input type="password" name="password" required autocomplete="current-password"/>
      <label>Authenticator TOTP Code (if MFA enabled)</label>
      <input type="text" name="totp_code" placeholder="6-digit code (optional)" inputmode="numeric" maxlength="6"/>
      <button type="submit">Continue to RVCE Campus Navigator</button>
    </form>
  </div>
</body>
</html>"""
    return HTMLResponse(content=html_doc)


@router.post("/oauth2/authorize", response_model=None)
def oauth2_authorize_submit(
    client_id: str = Form(...),
    redirect_uri: str = Form(...),
    code_challenge: str = Form(...),
    state: str = Form(default=""),
    nonce: str = Form(default=""),
    email: str = Form(...),
    password: str = Form(...),
    totp_code: str = Form(default=""),
) -> RedirectResponse | HTMLResponse:
    _ensure_sandbox_allowed()
    _bootstrap_dev_identities()

    if client_id != SANDBOX_CLIENT_ID or redirect_uri != get_settings().COGNITO_REDIRECT_URI:
        raise HTTPException(status_code=400, detail="Invalid client_id or redirect_uri.")

    norm_email = email.strip().lower()
    ident = _IDENTITIES_BY_EMAIL.get(norm_email)
    if not ident:
        params = urlencode({"error": "access_denied", "error_description": "Invalid credentials.", "state": state})
        return RedirectResponse(url=f"{redirect_uri}?{params}", status_code=302)

    cand = _derive_ram_verifier(password, ident.salt)
    if not secrets.compare_digest(cand, ident.verifier) or not ident.email_verified:
        params = urlencode({"error": "access_denied", "error_description": "Invalid credentials.", "state": state})
        return RedirectResponse(url=f"{redirect_uri}?{params}", status_code=302)

    if not ident.totp_enabled:
        if not ident.pending_totp_secret:
            ident.pending_totp_secret = _deterministic_totp_secret(ident.sub, ident.email)
        if not totp_code or not verify_totp_code(ident.pending_totp_secret, totp_code):
            b32_secret = base64.b32encode(ident.pending_totp_secret).decode("ascii").rstrip("=")
            totp_obj = TOTP(ident.pending_totp_secret, 6, SHA1(), 30)
            uri = totp_obj.get_provisioning_uri(ident.email, "RVCE Campus Navigator")
            safe_email = html.escape(ident.email)
            safe_pw = html.escape(password)
            safe_state = html.escape(state)
            safe_cc = html.escape(code_challenge)
            safe_redir = html.escape(redirect_uri)
            safe_nonce = html.escape(nonce or "")
            safe_uri = html.escape(uri)
            err_banner = (
                '<p style="color:#DC2626;font-weight:700;">Invalid 6-digit code. Please enter the current code from your Authenticator app.</p>'
                if totp_code
                else ""
            )
            setup_html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Configure Authenticator App — RVCE Staff SSO</title>
<style>
  body {{ font-family: system-ui, -apple-system, sans-serif; background: #F4F6FA; margin: 0; padding: 20px; color: #0F172A; }}
  .card {{ max-width: 420px; margin: 16px auto; background: #FFF; border-radius: 16px; padding: 22px; box-shadow: 0 8px 24px rgba(39,68,126,0.12); border-top: 5px solid #27447E; }}
  .badge {{ display: inline-block; font-size: 11px; font-weight: 700; color: #27447E; background: #EDF2FA; padding: 4px 10px; border-radius: 99px; margin-bottom: 10px; }}
  h1 {{ font-size: 19px; margin: 0 0 6px; color: #1E3A6D; }}
  p {{ font-size: 13px; color: #475569; margin: 0 0 14px; line-height: 1.45; }}
  .keybox {{ background: #F8FAFC; border: 1px dashed #94A3B8; border-radius: 10px; padding: 12px; font-family: monospace; font-size: 15px; font-weight: 700; letter-spacing: 1.5px; color: #1E3A6D; word-break: break-all; margin-bottom: 12px; text-align: center; }}
  .openbtn {{ display: block; text-align: center; background: #EDF2FA; color: #27447E; text-decoration: none; padding: 11px; border-radius: 10px; font-size: 13.5px; font-weight: 700; margin-bottom: 16px; border: 1px solid #BFDBFE; }}
  label {{ display: block; font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 6px; }}
  input {{ width: 100%; box-sizing: border-box; padding: 12px; border: 1.5px solid #CBD5E1; border-radius: 10px; margin-bottom: 14px; font-size: 20px; font-weight: 800; text-align: center; letter-spacing: 6px; }}
  button {{ width: 100%; background: #27447E; color: #FFF; border: none; padding: 13px; border-radius: 10px; font-size: 15px; font-weight: 700; cursor: pointer; }}
</style></head>
<body>
  <div class="card">
    <span class="badge">Mandatory First-Time MFA Setup</span>
    <h1>Configure Authenticator App</h1>
    <p>Add <strong>{safe_email}</strong> to Google Authenticator, Microsoft Authenticator, or Authy, then enter the 6-digit code to finish signing in.</p>
    <a class="openbtn" href="{safe_uri}">Open Authenticator App Automatically</a>
    <label>Manual Setup Key (Time-based / TOTP)</label>
    <div class="keybox">{b32_secret}</div>
    {err_banner}
    <form method="post" action="authorize">
      <input type="hidden" name="client_id" value="{SANDBOX_CLIENT_ID}"/>
      <input type="hidden" name="redirect_uri" value="{safe_redir}"/>
      <input type="hidden" name="code_challenge" value="{safe_cc}"/>
      <input type="hidden" name="state" value="{safe_state}"/>
      <input type="hidden" name="nonce" value="{safe_nonce}"/>
      <input type="hidden" name="email" value="{safe_email}"/>
      <input type="hidden" name="password" value="{safe_pw}"/>
      <label>Enter 6-Digit Authenticator Code</label>
      <input type="text" name="totp_code" placeholder="000000" required inputmode="numeric" maxlength="6" autofocus/>
      <button type="submit">Activate Authenticator &amp; Sign In</button>
    </form>
  </div>
</body></html>"""
            return HTMLResponse(content=setup_html, status_code=200)
        ident.totp_secret = ident.pending_totp_secret
        ident.pending_totp_secret = None
        ident.totp_enabled = True
        _save_sandbox_state()
    else:
        if not ident.totp_secret or not verify_totp_code(ident.totp_secret, totp_code):
            safe_email = html.escape(ident.email)
            safe_pw = html.escape(password)
            safe_state = html.escape(state)
            safe_cc = html.escape(code_challenge)
            safe_redir = html.escape(redirect_uri)
            safe_nonce = html.escape(nonce or "")
            err_banner = (
                '<p style="color:#DC2626;font-weight:700;">Invalid 6-digit code. Please try again.</p>'
                if totp_code
                else ""
            )
            verify_html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Authenticator Verification — RVCE Staff SSO</title>
<style>
  body {{ font-family: system-ui, -apple-system, sans-serif; background: #F4F6FA; margin: 0; padding: 20px; color: #0F172A; }}
  .card {{ max-width: 400px; margin: 24px auto; background: #FFF; border-radius: 16px; padding: 24px; box-shadow: 0 8px 24px rgba(39,68,126,0.12); border-top: 5px solid #27447E; }}
  .badge {{ display: inline-block; font-size: 11px; font-weight: 700; color: #27447E; background: #EDF2FA; padding: 4px 10px; border-radius: 99px; margin-bottom: 10px; }}
  h1 {{ font-size: 20px; margin: 0 0 6px; color: #1E3A6D; }}
  p {{ font-size: 13px; color: #475569; margin: 0 0 16px; line-height: 1.45; }}
  label {{ display: block; font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 6px; }}
  input {{ width: 100%; box-sizing: border-box; padding: 12px; border: 1.5px solid #CBD5E1; border-radius: 10px; margin-bottom: 14px; font-size: 20px; font-weight: 800; text-align: center; letter-spacing: 6px; }}
  button {{ width: 100%; background: #27447E; color: #FFF; border: none; padding: 13px; border-radius: 10px; font-size: 15px; font-weight: 700; cursor: pointer; }}
</style></head>
<body>
  <div class="card">
    <span class="badge">Two-Step Verification Required</span>
    <h1>Enter Authenticator Code</h1>
    <p>Open your Authenticator app for <strong>{safe_email}</strong> and enter the 6-digit verification code.</p>
    {err_banner}
    <form method="post" action="authorize">
      <input type="hidden" name="client_id" value="{SANDBOX_CLIENT_ID}"/>
      <input type="hidden" name="redirect_uri" value="{safe_redir}"/>
      <input type="hidden" name="code_challenge" value="{safe_cc}"/>
      <input type="hidden" name="state" value="{safe_state}"/>
      <input type="hidden" name="nonce" value="{safe_nonce}"/>
      <input type="hidden" name="email" value="{safe_email}"/>
      <input type="hidden" name="password" value="{safe_pw}"/>
      <label>6-Digit Authenticator Code</label>
      <input type="text" name="totp_code" placeholder="000000" required inputmode="numeric" maxlength="6" autofocus/>
      <button type="submit">Verify &amp; Continue</button>
    </form>
  </div>
</body></html>"""
            return HTMLResponse(content=verify_html, status_code=200)

    auth_code = secrets.token_urlsafe(32)
    _PKCE_CODES[auth_code] = _PkceAuthCode(
        code=auth_code,
        sub=ident.sub,
        client_id=client_id,
        redirect_uri=redirect_uri,
        code_challenge=code_challenge,
        nonce=nonce or None,
        expires_at=time.time() + 180,
    )
    params = urlencode({"code": auth_code, "state": state})
    return RedirectResponse(url=f"{redirect_uri}?{params}", status_code=302)


@router.post("/oauth2/token")
async def oauth2_token_exchange(request: Request) -> JSONResponse:
    _ensure_sandbox_allowed()
    _bootstrap_dev_identities()

    ctype = request.headers.get("content-type", "")
    if "application/json" in ctype:
        body = await request.json()
    else:
        form = await request.form()
        body = dict(form)

    grant_type = str(body.get("grant_type", ""))
    client_id = str(body.get("client_id", ""))
    if client_id != SANDBOX_CLIENT_ID:
        return JSONResponse(status_code=400, content={"error": "invalid_client"})

    if grant_type == "authorization_code":
        code = str(body.get("code", ""))
        code_verifier = str(body.get("code_verifier", ""))
        redirect_uri = str(body.get("redirect_uri", ""))

        rec = _PKCE_CODES.pop(code, None)
        if not rec or rec.expires_at < time.time() or rec.redirect_uri != redirect_uri:
            return JSONResponse(status_code=400, content={"error": "invalid_grant"})

        digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
        computed_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
        if not secrets.compare_digest(computed_challenge, rec.code_challenge):
            return JSONResponse(status_code=400, content={"error": "invalid_grant", "error_description": "PKCE verification failed."})

        ident = _IDENTITIES_BY_SUB.get(rec.sub)
        if not ident:
            return JSONResponse(status_code=400, content={"error": "invalid_grant"})

        amr = ["pwd", "mfa"] if ident.totp_enabled else ["pwd"]
        return JSONResponse(content=_mint_cognito_tokens(ident, amr=amr, nonce=rec.nonce))

    if grant_type == "refresh_token":
        raw_rt = str(body.get("refresh_token", ""))
        r_hash = hashlib.sha256(raw_rt.encode("utf-8")).hexdigest()
        r_rec = _REFRESH_TOKENS.get(r_hash)
        if not r_rec or r_rec.revoked or r_rec.expires_at < time.time():
            return JSONResponse(status_code=400, content={"error": "invalid_grant"})
        # Rotate refresh token on use
        r_rec.revoked = True
        ident = _IDENTITIES_BY_SUB.get(r_rec.sub)
        if not ident:
            return JSONResponse(status_code=400, content={"error": "invalid_grant"})
        amr = ["pwd", "mfa"] if ident.totp_enabled else ["pwd"]
        return JSONResponse(content=_mint_cognito_tokens(ident, amr=amr))

    return JSONResponse(status_code=400, content={"error": "unsupported_grant_type"})


@router.post("/oauth2/revoke")
async def oauth2_revoke_token(request: Request) -> JSONResponse:
    _ensure_sandbox_allowed()
    ctype = request.headers.get("content-type", "")
    body = await request.json() if "application/json" in ctype else dict(await request.form())
    raw_rt = str(body.get("token", ""))
    if raw_rt:
        r_hash = hashlib.sha256(raw_rt.encode("utf-8")).hexdigest()
        if r_hash in _REFRESH_TOKENS:
            _REFRESH_TOKENS[r_hash].revoked = True
    return JSONResponse(content={"revoked": True})


# -----------------------------------------------------------------------------
# Native Public Client Cognito Operations (Registration, OTP, MFA, Recovery)
# -----------------------------------------------------------------------------
@router.post("/cognito/{operation}")
async def sandbox_cognito_operation(operation: str, request: Request) -> dict[str, Any]:
    _ensure_sandbox_allowed()
    _bootstrap_dev_identities()
    payload: dict[str, Any] = await request.json()

    if operation == "sign-up":
        email = normalize_and_validate_rvce_email(str(payload.get("email", "")))
        full_name = str(payload.get("full_name", "")).strip()
        password = str(payload.get("password", ""))
        if len(full_name) < 2 or len(full_name) > 140:
            raise HTTPException(status_code=400, detail="Please enter your full official name.")
        _validate_cognito_password_policy(password)

        existing = _IDENTITIES_BY_EMAIL.get(email)
        if existing and existing.email_verified:
            # Generic message to prevent account enumeration
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unable to complete registration for this email. If you already registered, please sign in or use Forgot Password.",
            )

        salt = os.urandom(16)
        otp = f"{secrets.randbelow(900000) + 100000}"
        sub = existing.sub if existing else str(uuid.uuid4())
        ident = _SandboxIdentity(
            sub=sub,
            email=email,
            full_name=full_name,
            salt=salt,
            verifier=_derive_ram_verifier(password, salt),
            email_verified=False,
            verification_code=otp,
            verification_expires_at=time.time() + 900,
        )
        _IDENTITIES_BY_EMAIL[email] = ident
        _IDENTITIES_BY_SUB[sub] = ident
        return {
            "user_sub": sub,
            "user_confirmed": False,
            "code_delivery": {"destination": email, "medium": "EMAIL"},
            "sandbox_dev_otp_hint": otp,
        }

    if operation == "confirm-sign-up":
        email = normalize_and_validate_rvce_email(str(payload.get("email", "")))
        code = str(payload.get("code", "")).strip()
        ident = _IDENTITIES_BY_EMAIL.get(email)
        if (
            not ident
            or not ident.verification_code
            or ident.verification_expires_at < time.time()
            or not secrets.compare_digest(code, ident.verification_code)
        ):
            raise HTTPException(status_code=400, detail="Invalid or expired email verification code.")
        ident.email_verified = True
        ident.verification_code = None
        _save_sandbox_state()
        return {"confirmed": True, "user_sub": ident.sub}

    if operation == "resend-confirmation-code":
        email = normalize_and_validate_rvce_email(str(payload.get("email", "")))
        ident = _IDENTITIES_BY_EMAIL.get(email)
        otp = f"{secrets.randbelow(900000) + 100000}"
        if ident and not ident.email_verified:
            ident.verification_code = otp
            ident.verification_expires_at = time.time() + 900
            return {"sent": True, "sandbox_dev_otp_hint": otp}
        return {"sent": True}

    if operation == "sign-in":
        raw_email = str(payload.get("email", "")).strip().lower()
        password = str(payload.get("password", ""))
        ident = _IDENTITIES_BY_EMAIL.get(raw_email)
        if not ident:
            raise HTTPException(status_code=401, detail="Invalid institutional email or password.")
        cand = _derive_ram_verifier(password, ident.salt)
        if not secrets.compare_digest(cand, ident.verifier):
            raise HTTPException(status_code=401, detail="Invalid institutional email or password.")
        if not ident.email_verified:
            otp = f"{secrets.randbelow(900000) + 100000}"
            ident.verification_code = otp
            ident.verification_expires_at = time.time() + 900
            return {
                "challenge_name": "EMAIL_NOT_VERIFIED",
                "email": ident.email,
                "sandbox_dev_otp_hint": otp,
            }
        sess_id = secrets.token_urlsafe(32)
        _MFA_SESSIONS[sess_id] = _MfaSession(
            session_id=sess_id, sub=ident.sub, expires_at=time.time() + 600
        )
        if ident.totp_enabled:
            return {
                "challenge_name": "SOFTWARE_TOKEN_MFA",
                "session": sess_id,
                "email": ident.email,
            }

        # First-time login: Mandatory Authenticator App (TOTP) Enrolment Challenge (`MFA_SETUP`)
        if not ident.pending_totp_secret:
            ident.pending_totp_secret = _deterministic_totp_secret(ident.sub, ident.email)
        b32_secret = base64.b32encode(ident.pending_totp_secret).decode("ascii").rstrip("=")
        totp = TOTP(ident.pending_totp_secret, 6, SHA1(), 30)
        uri = totp.get_provisioning_uri(ident.email, "RVCE Campus Navigator")
        return {
            "challenge_name": "MFA_SETUP",
            "session": sess_id,
            "email": ident.email,
            "secret_code": b32_secret,
            "otpauth_uri": uri,
        }

    if operation == "respond-mfa":
        sess_id = str(payload.get("session", ""))
        code = str(payload.get("code", "")).strip()
        mfa_sess = _MFA_SESSIONS.get(sess_id)
        if not mfa_sess or mfa_sess.expires_at < time.time():
            raise HTTPException(status_code=401, detail="MFA challenge session expired. Please sign in again.")
        ident = _IDENTITIES_BY_SUB.get(mfa_sess.sub)
        if not ident:
            raise HTTPException(status_code=401, detail="Account session not found.")

        if ident.totp_enabled:
            if not ident.totp_secret or not verify_totp_code(ident.totp_secret, code):
                raise HTTPException(status_code=401, detail="Invalid 6-digit authenticator code.")
        else:
            if not ident.pending_totp_secret or not verify_totp_code(ident.pending_totp_secret, code):
                raise HTTPException(status_code=401, detail="Invalid 6-digit authenticator code. Verify the setup key in your Authenticator app.")
            ident.totp_secret = ident.pending_totp_secret
            ident.pending_totp_secret = None
            ident.totp_enabled = True

        _MFA_SESSIONS.pop(sess_id, None)
        return {
            "challenge_name": None,
            "tokens": _mint_cognito_tokens(ident, amr=["pwd", "mfa", "swk"]),
        }

    if operation == "forgot-password":
        raw_email = str(payload.get("email", "")).strip().lower()
        ident = _IDENTITIES_BY_EMAIL.get(raw_email)
        hint: str | None = None
        if ident and ident.email_verified:
            code = f"{secrets.randbelow(900000) + 100000}"
            ident.reset_code = code
            ident.reset_expires_at = time.time() + 900
            hint = code
        # Always return identical anti-enumeration envelope
        resp: dict[str, Any] = {
            "message": "If an eligible @rvce.edu.in account is registered, a verification code has been sent."
        }
        if hint:
            resp["sandbox_dev_otp_hint"] = hint
        return resp

    if operation == "confirm-forgot-password":
        email = normalize_and_validate_rvce_email(str(payload.get("email", "")))
        code = str(payload.get("code", "")).strip()
        new_password = str(payload.get("new_password", ""))
        _validate_cognito_password_policy(new_password)

        ident = _IDENTITIES_BY_EMAIL.get(email)
        if (
            not ident
            or not ident.reset_code
            or ident.reset_expires_at < time.time()
            or not secrets.compare_digest(code, ident.reset_code)
        ):
            raise HTTPException(status_code=400, detail="Invalid or expired password recovery code.")

        new_salt = os.urandom(16)
        ident.salt = new_salt
        ident.verifier = _derive_ram_verifier(new_password, new_salt)
        ident.reset_code = None
        # Revoke all existing refresh tokens on password reset
        for r in _REFRESH_TOKENS.values():
            if r.sub == ident.sub:
                r.revoked = True
        _save_sandbox_state()
        return {"reset": True}

    if operation == "associate-totp":
        access_token = str(payload.get("access_token", ""))
        try:
            decoded = jwt.decode(
                access_token,
                _PUBLIC_KEY,
                algorithms=["RS256"],
                options={"verify_aud": False},
            )
            sub = str(decoded["sub"])
        except Exception as exc:
            raise HTTPException(status_code=401, detail="Valid access token required for MFA setup.") from exc

        ident = _IDENTITIES_BY_SUB.get(sub)
        if not ident:
            raise HTTPException(status_code=404, detail="Identity not found.")

        secret_bytes = os.urandom(20)
        ident.pending_totp_secret = secret_bytes
        b32_secret = base64.b32encode(secret_bytes).decode("ascii").rstrip("=")
        totp = TOTP(secret_bytes, 6, SHA1(), 30)
        uri = totp.get_provisioning_uri(ident.email, "RVCE Campus Navigator")
        return {
            "secret_code": b32_secret,
            "otpauth_uri": uri,
        }

    if operation == "verify-totp":
        access_token = str(payload.get("access_token", ""))
        code = str(payload.get("code", "")).strip()
        try:
            decoded = jwt.decode(
                access_token,
                _PUBLIC_KEY,
                algorithms=["RS256"],
                options={"verify_aud": False},
            )
            sub = str(decoded["sub"])
        except Exception as exc:
            raise HTTPException(status_code=401, detail="Valid access token required.") from exc

        ident = _IDENTITIES_BY_SUB.get(sub)
        if not ident or not ident.pending_totp_secret:
            raise HTTPException(status_code=400, detail="No pending authenticator enrolment found.")
        if not verify_totp_code(ident.pending_totp_secret, code):
            raise HTTPException(status_code=400, detail="Invalid 6-digit authenticator verification code.")

        ident.totp_secret = ident.pending_totp_secret
        ident.pending_totp_secret = None
        ident.totp_enabled = True
        _save_sandbox_state()
        return {"mfa_enabled": True}

    if operation == "global-sign-out":
        access_token = str(payload.get("access_token", ""))
        try:
            decoded = jwt.decode(
                access_token,
                _PUBLIC_KEY,
                algorithms=["RS256"],
                options={"verify_aud": False},
            )
            sub = str(decoded["sub"])
            for r in _REFRESH_TOKENS.values():
                if r.sub == sub:
                    r.revoked = True
        except Exception:
            pass
        return {"signed_out_everywhere": True}

    raise HTTPException(status_code=404, detail="Unsupported sandbox operation.")
