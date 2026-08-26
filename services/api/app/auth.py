"""Supabase access-token verification with a keyless local identity fallback."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol, cast
from uuid import UUID

import jwt
from fastapi import Request
from fastapi.concurrency import run_in_threadpool
from jwt import InvalidTokenError, PyJWKClient, PyJWKClientError

from .config import Settings
from .errors import InkError

BEARER_PATTERN = re.compile(r"^Bearer ([A-Za-z0-9._~-]+)$", re.IGNORECASE)
ALLOWED_ALGORITHMS = frozenset({"RS256", "ES256", "EdDSA"})


@dataclass(frozen=True, slots=True)
class Identity:
    owner_id: str
    email: str | None = None


class TokenVerifier(Protocol):
    def verify(self, token: str) -> Identity: ...


class SupabaseTokenVerifier:
    """Verify asymmetric Supabase JWTs from the project's cached JWKS endpoint."""

    def __init__(self, supabase_url: str) -> None:
        self.issuer = f"{supabase_url}/auth/v1"
        self.jwks = PyJWKClient(
            f"{self.issuer}/.well-known/jwks.json",
            cache_keys=True,
            lifespan=600,
            timeout=5,
        )

    def verify(self, token: str) -> Identity:
        try:
            header = jwt.get_unverified_header(token)
            algorithm = header.get("alg")
            if algorithm not in ALLOWED_ALGORITHMS:
                raise InvalidTokenError("unsupported signing algorithm")
            signing_key = self.jwks.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=[algorithm],
                audience="authenticated",
                issuer=self.issuer,
                options={"require": ["exp", "iat", "iss", "sub", "aud"]},
            )
            if claims.get("role") != "authenticated" or claims.get("is_anonymous") is True:
                raise InvalidTokenError("authenticated non-anonymous session required")
            owner_id = str(UUID(str(claims["sub"])))
            email = claims.get("email")
            return Identity(owner_id=owner_id, email=email if isinstance(email, str) else None)
        except (InvalidTokenError, KeyError, TypeError, ValueError, PyJWKClientError) as exc:
            raise InkError(
                "AUTHENTICATION_REQUIRED",
                "Sign in again to continue.",
                status_code=401,
            ) from exc


def build_token_verifier(settings: Settings) -> TokenVerifier | None:
    return SupabaseTokenVerifier(settings.supabase_url) if settings.hosted else None


async def require_identity(request: Request) -> Identity:
    settings = cast(Settings, request.app.state.settings)
    if not settings.hosted:
        identity = Identity(owner_id="local")
        request.state.identity = identity
        return identity

    authorization = request.headers.get("Authorization", "")
    match = BEARER_PATTERN.fullmatch(authorization)
    if match is None:
        raise InkError(
            "AUTHENTICATION_REQUIRED",
            "Sign in to continue.",
            status_code=401,
        )
    verifier = cast(TokenVerifier, request.app.state.token_verifier)
    identity = await run_in_threadpool(verifier.verify, match.group(1))
    request.state.identity = identity
    return identity


def request_owner(request: Request) -> str:
    identity = getattr(request.state, "identity", None)
    if not isinstance(identity, Identity):
        raise RuntimeError("authenticated identity was not attached to the request")
    return identity.owner_id
