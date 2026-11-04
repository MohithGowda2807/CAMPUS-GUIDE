from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, OperationalError

from backend.app.api.admin import router as admin_router
from backend.app.api.auth_routes import router as auth_router
from backend.app.api.public import router as public_router
from backend.app.api.visitors import router as visitors_router
from backend.app.config.database import check_databases_health
from backend.app.config.settings import get_settings


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.APP_NAME,
        version="1.0.0",
        description="Official Campus Navigation, Facility Directory & Visitor Management API for R. V. College of Engineering.",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_origin_regex=r"^https?://.*|^capacitor://.*",
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.exception_handler(IntegrityError)
    async def handle_integrity_error(_: Request, exc: IntegrityError) -> JSONResponse:
        return JSONResponse(
            status_code=409,
            content={
                "detail": "Database constraint violation: duplicate identifier or invalid foreign key reference.",
                "code": "INTEGRITY_CONFLICT",
            },
        )

    @app.exception_handler(OperationalError)
    async def handle_mysql_operational_error(_: Request, exc: OperationalError) -> JSONResponse:
        msg = str(exc.orig) if getattr(exc, "orig", None) else "Database service is temporarily unavailable."
        # Preserve custom MySQL SIGNAL SQLSTATE '45000' business rule messages (errno 1644)
        if getattr(exc, "orig", None) and getattr(exc.orig, "args", None) and exc.orig.args[0] == 1644:
            return JSONResponse(status_code=400, content={"detail": exc.orig.args[1], "code": "RULE_VIOLATION"})
        return JSONResponse(
            status_code=503,
            content={
                "detail": "Primary campus database connection unavailable. Verify MySQL service and credentials in .env.",
                "diagnostic": msg.splitlines()[0][:180],
                "code": "DATABASE_UNAVAILABLE",
            },
        )

    @app.get(f"{settings.API_V1_PREFIX}/health", tags=["Service Health"])
    async def service_health() -> dict[str, Any]:
        status_report = await check_databases_health()
        return {
            "service": settings.APP_NAME,
            "environment": settings.APP_ENV,
            **status_report,
        }

    app.include_router(public_router, prefix=settings.API_V1_PREFIX)
    app.include_router(auth_router, prefix=settings.API_V1_PREFIX)
    app.include_router(visitors_router, prefix=settings.API_V1_PREFIX)
    app.include_router(admin_router, prefix=settings.API_V1_PREFIX)

    return app


app = create_app()
