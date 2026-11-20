from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from urllib.parse import quote_plus
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(REPO_ROOT / ".env.example"), str(REPO_ROOT / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    APP_ENV: str = "development"
    APP_NAME: str = "RVCE Campus Navigation & Visitor Management Portal"
    API_V1_PREFIX: str = "/api/v1"
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Amazon Cognito User Pools (Public OIDC / OAuth 2.0 PKCE Client — Zero Client Secret)
    COGNITO_REGION: str = "ap-south-1"
    COGNITO_USER_POOL_ID: str = ""
    COGNITO_APP_CLIENT_ID: str = ""
    COGNITO_DOMAIN: str = ""
    COGNITO_REDIRECT_URI: str = "rvce-navigator://auth/callback"
    COGNITO_LOGOUT_URI: str = "rvce-navigator://auth/logout"
    COGNITO_JWKS_CACHE_SECONDS: int = 3600
    ALLOWED_STAFF_EMAIL_DOMAIN: str = "rvce.edu.in"

    # Strictly gated to non-production local development when Cognito Pool ID is not yet set
    DEV_OIDC_SANDBOX_ENABLED: bool = True

    # 32-byte Base64 key for AES-256-GCM authenticated field protection
    DATA_PROTECTION_KEY_B64: str = ""

    MYSQL_HOST: str = "127.0.0.1"
    MYSQL_PORT: int = 3306
    MYSQL_USER: str = "root"
    MYSQL_PASSWORD: str = ""
    MYSQL_DATABASE: str = "campusguide"

    MONGODB_URI: str = "mongodb://127.0.0.1:27017"
    MONGODB_DATABASE: str = "campusguide_nosql"

    MAP_DEFAULT_LAT: float = 12.923550
    MAP_DEFAULT_LNG: float = 77.499850
    MAP_DEFAULT_ZOOM: int = 17
    MAP_TILE_URL: str = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    MAP_ATTRIBUTION: str = (
        "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors"
    )

    @property
    def is_production(self) -> bool:
        return self.APP_ENV.strip().lower() == "production"

    @property
    def use_aws_cognito(self) -> bool:
        return bool(self.COGNITO_USER_POOL_ID.strip() and self.COGNITO_APP_CLIENT_ID.strip())

    @property
    def use_dev_oidc_sandbox(self) -> bool:
        if self.is_production:
            return False
        return (not self.use_aws_cognito) and self.DEV_OIDC_SANDBOX_ENABLED

    @property
    def cognito_issuer(self) -> str:
        if self.use_aws_cognito:
            return (
                f"https://cognito-idp.{self.COGNITO_REGION.strip()}.amazonaws.com/"
                f"{self.COGNITO_USER_POOL_ID.strip()}"
            )
        return "https://dev-oidc.rvce-navigator.local"

    @property
    def cognito_jwks_url(self) -> str:
        return f"{self.cognito_issuer}/.well-known/jwks.json"

    @property
    def effective_client_id(self) -> str:
        if self.use_aws_cognito:
            return self.COGNITO_APP_CLIENT_ID.strip()
        return "rvce-mobile-public-client"

    def validate_security_posture(self) -> None:
        if self.is_production:
            if not self.use_aws_cognito:
                raise RuntimeError(
                    "Production startup blocked: COGNITO_USER_POOL_ID and COGNITO_APP_CLIENT_ID "
                    "must be configured when APP_ENV=production."
                )
            if not self.DATA_PROTECTION_KEY_B64.strip():
                raise RuntimeError(
                    "Production startup blocked: DATA_PROTECTION_KEY_B64 (32-byte Base64 AES-256-GCM key) "
                    "is required when APP_ENV=production."
                )

    @property
    def mysql_sqlalchemy_url(self) -> str:
        encoded_user = quote_plus(self.MYSQL_USER)
        encoded_pwd = quote_plus(self.MYSQL_PASSWORD)
        return (
            f"mysql+pymysql://{encoded_user}:{encoded_pwd}"
            f"@{self.MYSQL_HOST}:{self.MYSQL_PORT}/{self.MYSQL_DATABASE}?charset=utf8mb4"
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
