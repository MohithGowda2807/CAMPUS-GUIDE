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

    JWT_SECRET_KEY: str = "change-this-to-a-secure-random-64-char-hex-secret-before-deploy"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

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
