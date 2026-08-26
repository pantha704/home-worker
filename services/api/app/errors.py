"""Structured, request-correlated API errors."""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException


class InkError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details


def error_payload(request: Request, error: InkError) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "code": error.code,
        "message": error.message,
        "requestId": getattr(request.state, "request_id", "unknown"),
    }
    if error.details:
        payload["details"] = error.details
    return {"error": payload}


async def ink_error_handler(request: Request, exc: InkError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=error_payload(request, exc),
        headers={"X-Request-ID": getattr(request.state, "request_id", "unknown")},
    )


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    error = InkError(
        "VALIDATION_ERROR",
        "The request did not match the API contract.",
        status_code=422,
        details={"issues": jsonable_encoder(exc.errors())},
    )
    return await ink_error_handler(request, error)


async def http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
    message = exc.detail if isinstance(exc.detail, str) else "The request could not be completed."
    error = InkError(
        "HTTP_ERROR" if exc.status_code != 404 else "ROUTE_NOT_FOUND",
        message,
        status_code=exc.status_code,
    )
    return await ink_error_handler(request, error)


async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logging.getLogger("homeworker.api").exception(
        json.dumps(
            {
                "event": "unhandled_exception",
                "requestId": getattr(request.state, "request_id", "unknown"),
            },
            separators=(",", ":"),
        ),
        exc_info=exc,
    )
    error = InkError(
        "INTERNAL_ERROR",
        "An unexpected server error occurred.",
        status_code=500,
    )
    return await ink_error_handler(request, error)
