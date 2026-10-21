"""ドメイン例外を詳細設計の HTTP ステータスへ変換する。"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from src.domain.exceptions import FlyerAppException

logger = logging.getLogger(__name__)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def handle_request_validation(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        logger.info("invalid input on %s: %s", request.url.path, exc.errors())
        return JSONResponse(
            status_code=422,
            content={
                "error_code": "INVALID_INPUT",
                "message": "入力内容を確認してください（文字数超過など）",
            },
        )

    @app.exception_handler(FlyerAppException)
    async def handle_flyer_error(
        request: Request,
        exc: FlyerAppException,
    ) -> JSONResponse:
        logger.warning("%s on %s: %s", exc.error_code, request.url.path, exc)
        return JSONResponse(
            status_code=exc.http_status,
            content={"error_code": exc.error_code, "message": exc.user_message},
        )

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error on %s", request.url.path)
        return JSONResponse(
            status_code=500,
            content={
                "error_code": "INTERNAL_ERROR",
                "message": "ただいま生成が混み合っています。少し時間をおいてお試しください。",
            },
        )
