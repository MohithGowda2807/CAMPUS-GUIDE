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
from backend.app.auth.data_protection import install_log_redaction
from backend.app.auth.dev_oidc_sandbox import router as dev_oidc_router
from backend.app.config.database import check_databases_health
from backend.app.config.settings import get_settings


def create_app() -> FastAPI:
    install_log_redaction()
    settings = get_settings()
    settings.validate_security_posture()

    app = FastAPI(
        title=settings.APP_NAME,
        version="2.1.0",
        description="Official Campus Navigation, Facility Directory & Staff Portal API for R. V. College of Engineering.",
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
    async def handle_integrity_error(_: Request, __: IntegrityError) -> JSONResponse:
        return JSONResponse(
            status_code=409,
            content={
                "detail": "Database constraint violation: duplicate identifier or invalid reference.",
                "code": "INTEGRITY_CONFLICT",
            },
        )

    @app.exception_handler(OperationalError)
    async def handle_mysql_operational_error(_: Request, exc: OperationalError) -> JSONResponse:
        # Preserve custom MySQL SIGNAL SQLSTATE '45000' business rule messages (errno 1644)
        if getattr(exc, "orig", None) and getattr(exc.orig, "args", None) and exc.orig.args[0] == 1644:
            return JSONResponse(status_code=400, content={"detail": exc.orig.args[1], "code": "RULE_VIOLATION"})
        return JSONResponse(
            status_code=503,
            content={
                "detail": "Campus database service is temporarily unavailable.",
                "code": "DATABASE_UNAVAILABLE",
            },
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_exception(_: Request, __: Exception) -> JSONResponse:
        # Never expose raw Python tracebacks or internal SQL details to clients
        return JSONResponse(
            status_code=500,
            content={
                "detail": "An unexpected server error occurred. Please try again later.",
                "code": "INTERNAL_ERROR",
            },
        )

    @app.get(f"{settings.API_V1_PREFIX}/health", tags=["Service Health"])
    async def service_health() -> dict[str, Any]:
        status_report = await check_databases_health()
        return {
            "service": settings.APP_NAME,
            "environment": settings.APP_ENV,
            "auth_provider_mode": "AWS_COGNITO" if settings.use_aws_cognito else "DEV_OIDC_SANDBOX",
            **status_report,
        }

    app.include_router(public_router, prefix=settings.API_V1_PREFIX)
    app.include_router(auth_router, prefix=settings.API_V1_PREFIX)
    app.include_router(visitors_router, prefix=settings.API_V1_PREFIX)
    app.include_router(admin_router, prefix=settings.API_V1_PREFIX)

    if settings.use_dev_oidc_sandbox:
        app.include_router(dev_oidc_router, prefix=settings.API_V1_PREFIX)

    return app


app = create_app()
