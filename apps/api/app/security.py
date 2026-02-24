from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
from pwdlib import PasswordHash

from app.core.config import settings

password_hasher = PasswordHash.recommended()
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return password_hasher.verify(password, password_hash)


def _token(
    user_id: UUID,
    tenant_id: UUID,
    session_id: UUID,
    token_type: str,
    expires: timedelta,
    jti: str | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "tenant_id": str(tenant_id),
        "sid": str(session_id),
        "type": token_type,
        "iat": now,
        "exp": now + expires,
    }
    if jti:
        payload["jti"] = jti
    return jwt.encode(payload, settings.secret_key.get_secret_value(), algorithm=ALGORITHM)


def create_access_token(user_id: UUID, tenant_id: UUID, session_id: UUID) -> str:
    return _token(
        user_id,
        tenant_id,
        session_id,
        "access",
        timedelta(minutes=settings.access_token_expire_minutes),
    )


def create_refresh_token(user_id: UUID, tenant_id: UUID, session_id: UUID, jti: str) -> str:
    return _token(
        user_id,
        tenant_id,
        session_id,
        "refresh",
        timedelta(days=settings.refresh_token_expire_days),
        jti,
    )


def decode_token_claims(token: str, expected_type: str = "access") -> dict:
    payload = jwt.decode(token, settings.secret_key.get_secret_value(), algorithms=[ALGORITHM])
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("Invalid token type")
    UUID(payload["sub"])
    UUID(payload["tenant_id"])
    UUID(payload["sid"])
    if expected_type == "refresh" and not payload.get("jti"):
        raise jwt.InvalidTokenError("Missing refresh token identifier")
    return payload


def decode_token(token: str, expected_type: str = "access") -> UUID:
    return UUID(decode_token_claims(token, expected_type)["sub"])
