from __future__ import annotations

import base64
import hashlib
import logging
import os
import re
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException, status

from backend.app.config.settings import get_settings

# Strict institutional email local-part pattern (no spaces, no quotes, no control characters)
_LOCAL_PART_RE = re.compile(r"^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$")

# Patterns redacted from application & access logs
_BEARER_RE = re.compile(r"(Bearer\s+)[A-Za-z0-9._\-~+/]+=*", re.IGNORECASE)
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")
_SENSITIVE_KV_RE = re.compile(
    r'("(?:password|new_password|confirm_password|access_token|id_token|refresh_token|'
    r'otp_code|totp_code|verification_code|mfa_secret|secret_code|recovery_code|code_verifier)"'
    r'\s*:\s*)"[^"]*"',
    re.IGNORECASE,
)
_QUERY_SECRET_RE = re.compile(
    r"((?:code|access_token|id_token|refresh_token|code_verifier)=)[^&\s]+",
    re.IGNORECASE,
)

_EPHEMERAL_DEV_KEY = os.urandom(32)


def normalize_and_validate_rvce_email(raw_email: str) -> str:
    """
    Normalizes an email address and enforces the exact institutional domain (`@rvce.edu.in`).
    Rejects subdomains (e.g. `@sub.rvce.edu.in`), lookalikes (`@rvce.edu.in.evil.com`),
    malformed local parts, or non-RVCE domains.
    """
    if not isinstance(raw_email, str):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A valid @rvce.edu.in institutional email address is required.",
        )

    cleaned = raw_email.strip().lower()
    if len(cleaned) < 13 or len(cleaned) > 150 or "@" not in cleaned or cleaned.count("@") != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only official @rvce.edu.in institutional email addresses are permitted.",
        )

    local_part, domain_part = cleaned.split("@", 1)
    allowed_domain = get_settings().ALLOWED_STAFF_EMAIL_DOMAIN.strip().lower()

    if domain_part != allowed_domain:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Registration and staff sign-in are restricted to @{allowed_domain} email addresses.",
        )

    if ".." in local_part or not _LOCAL_PART_RE.match(local_part):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid institutional email format.",
        )

    return f"{local_part}@{allowed_domain}"


def _get_aesgcm() -> AESGCM:
    settings = get_settings()
    raw_b64 = settings.DATA_PROTECTION_KEY_B64.strip()
    if raw_b64:
        key = base64.b64decode(raw_b64)
        if len(key) != 32:
            raise RuntimeError("DATA_PROTECTION_KEY_B64 must decode to exactly 32 bytes for AES-256-GCM.")
        return AESGCM(key)
    if settings.is_production:
        raise RuntimeError("DATA_PROTECTION_KEY_B64 is mandatory in production.")
    return AESGCM(_EPHEMERAL_DEV_KEY)


def encrypt_sensitive_field(plaintext: str, aad_context: str) -> bytes:
    """
    Encrypts sensitive personal metadata using AES-256-GCM with a 96-bit random nonce
    and context-bound Additional Authenticated Data (AAD) to prevent cross-record substitution.
    """
    aesgcm = _get_aesgcm()
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), aad_context.encode("utf-8"))
    return b"v1:" + nonce + ciphertext


def decrypt_sensitive_field(payload: bytes, aad_context: str) -> str:
    if not payload.startswith(b"v1:") or len(payload) < 31:
        raise ValueError("Invalid encrypted field envelope.")
    nonce = payload[3:15]
    ciphertext = payload[15:]
    aesgcm = _get_aesgcm()
    plain_bytes = aesgcm.decrypt(nonce, ciphertext, aad_context.encode("utf-8"))
    return plain_bytes.decode("utf-8")


def hash_jti(jti_or_token: str) -> str:
    """One-way SHA-256 digest so raw JWTs or identifiers are never persisted."""
    return hashlib.sha256(jti_or_token.encode("utf-8")).hexdigest()


def redact_sensitive_text(message: str) -> str:
    text_out = _BEARER_RE.sub(r"\1[REDACTED_TOKEN]", message)
    text_out = _JWT_RE.sub("[REDACTED_JWT]", text_out)
    text_out = _SENSITIVE_KV_RE.sub(r'\1"[REDACTED]"', text_out)
    text_out = _QUERY_SECRET_RE.sub(r"\1[REDACTED]", text_out)
    return text_out


class SensitiveLogRedactor(logging.Filter):
    """Prevents tokens, passwords, OTPs, MFA secrets, and PKCE verifiers from entering logs."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_sensitive_text(record.msg)
        if record.args:
            if isinstance(record.args, tuple):
                record.args = tuple(
                    redact_sensitive_text(a) if isinstance(a, str) else a for a in record.args
                )
            elif isinstance(record.args, dict):
                record.args = {
                    k: (redact_sensitive_text(v) if isinstance(v, str) else v)
                    for k, v in record.args.items()
                }
        return True


def install_log_redaction() -> None:
    redactor = SensitiveLogRedactor()
    for logger_name in ("", "uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"):
        lg = logging.getLogger(logger_name)
        if not any(isinstance(f, SensitiveLogRedactor) for f in lg.filters):
            lg.addFilter(redactor)
        for handler in lg.handlers:
            if not any(isinstance(f, SensitiveLogRedactor) for f in handler.filters):
                handler.addFilter(redactor)
