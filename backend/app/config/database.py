from __future__ import annotations

from collections.abc import Generator
from typing import Any
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine

from backend.app.config.settings import get_settings

_engine: Engine | None = None
_mongo_client: AsyncIOMotorClient | None = None


def get_mysql_engine() -> Engine:
    global _engine
    if _engine is None:
        settings = get_settings()
        _engine = create_engine(
            settings.mysql_sqlalchemy_url,
            pool_pre_ping=True,
            pool_recycle=1800,
            pool_size=10,
            max_overflow=20,
            future=True,
        )
    return _engine


def get_db_connection() -> Generator[Connection, None, None]:
    engine = get_mysql_engine()
    with engine.connect() as conn:
        yield conn


def get_mongo_client() -> AsyncIOMotorClient:
    global _mongo_client
    if _mongo_client is None:
        settings = get_settings()
        _mongo_client = AsyncIOMotorClient(
            settings.MONGODB_URI,
            serverSelectionTimeoutMS=3000,
        )
    return _mongo_client


def get_mongo_db() -> AsyncIOMotorDatabase:
    settings = get_settings()
    return get_mongo_client()[settings.MONGODB_DATABASE]


async def check_databases_health() -> dict[str, Any]:
    mysql_ok = False
    mysql_detail = "ok"
    try:
        engine = get_mysql_engine()
        with engine.connect() as conn:
            ver = conn.execute(text("SELECT VERSION()")).scalar()
            mysql_ok = True
            mysql_detail = f"MySQL {ver}"
    except Exception as exc:
        mysql_detail = f"MySQL connection error: {type(exc).__name__}"

    mongo_ok = False
    mongo_detail = "ok"
    try:
        db = get_mongo_db()
        info = await db.command("buildInfo")
        mongo_ok = True
        mongo_detail = f"MongoDB {info.get('version', 'connected')}"
    except Exception as exc:
        mongo_detail = f"MongoDB connection error: {type(exc).__name__}"

    return {
        "healthy": mysql_ok and mongo_ok,
        "mysql": {"connected": mysql_ok, "detail": mysql_detail},
        "mongodb": {"connected": mongo_ok, "detail": mongo_detail},
    }
