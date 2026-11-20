from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
import jwt
from jwt import PyJWKClient

from backend.app.auth.dev_oidc_sandbox import get_sandbox_public_key
from backend.app.config.settings import get_settings

_jwks_clients: dict[str, PyJWKClient] = {}


def _get_cognito_jwk_client(jwks_url: str, cache_seconds: int) -> PyJWKClient:
    client = _jwks_clients.get(jwks_url)
    if client is None:
        client = PyJWKClient(jwks_url, cache_keys=True, lifespan=cache_seconds)
        _jwks_clients[jwks_url] = client
    return client


def verify_cognito_jwt(
    raw_token: str,
    allowed_token_uses: tuple[str, ...] = ("access", "id"),
) -> dict[str, Any]:
    """
    Verifies an asymmetric RS256 JWT issued by Amazon Cognito User Pools
    (or the ephemeral RSA-2048 Dev OIDC Sandbox when APP_ENV != production and no Pool ID is set).

    Strictly enforces:
    - Algorithm == RS256 (blocks `none` and HS256 symmetric key confusion)
    - Issuer (`iss`) exact match
    - Expiration (`exp`) and Issued-At (`iat`)
    - Token use (`access` -> `client_id`, `id` -> `aud`)
    - Presence of immutable Cognito subject (`sub`)
    """
    settings = get_settings()
    settings.validate_security_posture()

    expected_issuer = settings.cognito_issuer
    expected_client_id = settings.effective_client_id

    try:
        unverified_header = jwt.get_unverified_header(raw_token)
        if unverified_header.get("alg") != "RS256":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unsupported token signing algorithm.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        if settings.use_aws_cognito:
            jwk_client = _get_cognito_jwk_client(
                settings.cognito_jwks_url,
                settings.COGNITO_JWKS_CACHE_SECONDS,
            )
            signing_key = jwk_client.get_signing_key_from_jwt(raw_token).key
        elif settings.use_dev_oidc_sandbox:
            signing_key = get_sandbox_public_key()
        else:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication identity provider is not configured.",
            )

        claims: dict[str, Any] = jwt.decode(
            raw_token,
            signing_key,
            algorithms=["RS256"],
            issuer=expected_issuer,
            options={
                "require": ["sub", "iss", "exp", "iat", "token_use"],
                "verify_aud": False,
            },
        )
    except HTTPException:
        raise
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session token has expired. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    token_use = claims.get("token_use")
    if token_use not in allowed_token_uses:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token type is not permitted for this operation.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if token_use == "access":
        if claims.get("client_id") != expected_client_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token client_id mismatch.",
                headers={"WWW-Authenticate": "Bearer"},
            )
    elif token_use == "id":
        aud = claims.get("aud")
        aud_ok = (aud == expected_client_id) or (isinstance(aud, list) and expected_client_id in aud)
        if not aud_ok:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token audience mismatch.",
                headers={"WWW-Authenticate": "Bearer"},
            )

    sub = str(claims.get("sub", "")).strip()
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token subject identifier is missing.",
        )

    return claims
