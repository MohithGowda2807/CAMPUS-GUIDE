from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, OperationalError

from backend.app.api.admin import router as admin_router
from backend.app.api.auth_routes import router as auth_router
from backend.app.api.public import router as public_router
from backend.app.api.visitors import router as visitors_router
from backend.app.auth.data_protection import SensitiveLogRedactor, install_log_redaction
from backend.app.auth.dev_oidc_sandbox import router as dev_oidc_router
from backend.app.config.database import check_databases_health
from backend.app.config.settings import get_settings


def _configure_file_logging() -> logging.Logger:
    log_dir = Path(__file__).resolve().parents[2] / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "rvce_backend.log"

    logger = logging.getLogger("rvce.backend")
    logger.setLevel(logging.INFO)
    if not any(isinstance(h, RotatingFileHandler) for h in logger.handlers):
        handler = RotatingFileHandler(
            log_file, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
        )
        handler.setFormatter(
            logging.Formatter("%(asctime)s | %(levelname)s | %(name)s | %(message)s")
        )
        handler.addFilter(SensitiveLogRedactor())
        logger.addHandler(handler)
    return logger


def create_app() -> FastAPI:
    install_log_redaction()
    app_logger = _configure_file_logging()
    settings = get_settings()
    settings.validate_security_posture()

    # Disable interactive OpenAPI/Swagger endpoints in production so internal API surface is not exposed
    app = FastAPI(
        title=settings.APP_NAME,
        version="2.2.0",
        description="Official Campus Navigation, Facility Directory & Staff Portal API for R. V. College of Engineering.",
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_origin_regex=None if settings.is_production else r"^https?://.*|^capacitor://.*",
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "Origin"],
    )

    @app.middleware("http")
    async def add_security_headers(request: Request, call_next: Any):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(self), camera=()"
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if any(
            request.url.path.startswith(f"{settings.API_V1_PREFIX}{p}")
            for p in ("/auth", "/admin", "/visits")
        ):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
            response.headers["Pragma"] = "no-cache"
        return response

    @app.exception_handler(IntegrityError)
    async def handle_integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
        err_id = uuid.uuid4().hex[:10]
        app_logger.warning("IntegrityError [%s] on %s %s: %s", err_id, request.method, request.url.path, type(exc).__name__)
        return JSONResponse(
            status_code=409,
            content={
                "detail": "Database constraint violation: duplicate identifier or invalid reference.",
                "code": "INTEGRITY_CONFLICT",
                "error_id": err_id,
            },
        )

    @app.exception_handler(OperationalError)
    async def handle_mysql_operational_error(request: Request, exc: OperationalError) -> JSONResponse:
        # Preserve custom MySQL SIGNAL SQLSTATE '45000' business rule messages (errno 1644)
        if getattr(exc, "orig", None) and getattr(exc.orig, "args", None) and exc.orig.args[0] == 1644:
            return JSONResponse(status_code=400, content={"detail": exc.orig.args[1], "code": "RULE_VIOLATION"})
        err_id = uuid.uuid4().hex[:10]
        app_logger.error("OperationalError [%s] on %s %s: %s", err_id, request.method, request.url.path, exc)
        return JSONResponse(
            status_code=503,
            content={
                "detail": "Campus database service is temporarily unavailable.",
                "code": "DATABASE_UNAVAILABLE",
                "error_id": err_id,
            },
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_exception(request: Request, exc: Exception) -> JSONResponse:
        # Log full redacted traceback internally with correlation ID; never expose raw stack traces to clients
        err_id = uuid.uuid4().hex[:10]
        app_logger.exception("UnhandledException [%s] on %s %s", err_id, request.method, request.url.path, exc_info=exc)
        return JSONResponse(
            status_code=500,
            content={
                "detail": f"An unexpected server error occurred (Ref: {err_id}). Please contact system support.",
                "code": "INTERNAL_ERROR",
                "error_id": err_id,
            },
        )

    @app.get(f"{settings.API_V1_PREFIX}/health", tags=["Service Health"])
    async def service_health() -> dict[str, Any]:
        status_report = await check_databases_health()
        if settings.is_production:
            return {
                "service": settings.APP_NAME,
                "status": "ok" if status_report["mysql"]["connected"] else "degraded",
                "healthy": status_report["healthy"],
                "mysql_connected": status_report["mysql"]["connected"],
                "mongodb_connected": status_report["mongodb"]["connected"],
            }
        return {
            "service": settings.APP_NAME,
            "status": "ok" if status_report["mysql"]["connected"] else "degraded",
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
