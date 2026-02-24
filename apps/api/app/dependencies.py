from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db import get_db
from app.models import Tenant, TenantMembership, TenantRole, User, UserSession
from app.security import decode_token_claims

bearer = HTTPBearer(auto_error=False)


@dataclass
class CurrentContext:
    user: User
    tenant: Tenant
    role: TenantRole


async def _token_from_request(
    request: Request, credentials: HTTPAuthorizationCredentials | None
) -> str:
    if credentials:
        return credentials.credentials
    token = request.cookies.get("lumix_access")
    if token:
        origin = request.headers.get("origin")
        if origin and origin not in settings.cors_origins:
            raise HTTPException(status_code=403, detail="Request origin is not allowed")
        return token
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        claims = decode_token_claims(await _token_from_request(request, credentials))
    except HTTPException:
        raise
    except (jwt.InvalidTokenError, ValueError, KeyError):
        raise HTTPException(status_code=401, detail="Invalid or expired access token")
    session_id = UUID(claims["sid"])
    user_id = UUID(claims["sub"])
    tenant_id = UUID(claims["tenant_id"])
    session = await db.scalar(
        select(UserSession).where(
            UserSession.id == session_id,
            UserSession.user_id == user_id,
            UserSession.tenant_id == tenant_id,
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > datetime.now(timezone.utc),
        )
    )
    if not session:
        raise HTTPException(status_code=401, detail="Session has expired or been revoked")
    user = await db.scalar(select(User).where(User.id == user_id, User.is_active.is_(True)))
    if not user:
        raise HTTPException(status_code=401, detail="User is inactive or no longer exists")
    return user


async def get_current_context(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CurrentContext:
    try:
        claims = decode_token_claims(await _token_from_request(request, credentials))
        tenant_id = UUID(claims["tenant_id"])
    except HTTPException:
        raise
    except (jwt.InvalidTokenError, ValueError, KeyError):
        raise HTTPException(status_code=401, detail="Invalid tenant context")
    membership = await db.scalar(
        select(TenantMembership).where(
            TenantMembership.user_id == user.id,
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.is_active.is_(True),
        )
    )
    if not membership:
        raise HTTPException(status_code=403, detail="No active membership for this organization")
    tenant = await db.get(Tenant, membership.tenant_id)
    if not tenant or not tenant.is_active:
        raise HTTPException(status_code=403, detail="Organization is inactive")
    return CurrentContext(user, tenant, membership.role)


def require_roles(*roles: TenantRole):
    async def dependency(context: CurrentContext = Depends(get_current_context)) -> CurrentContext:
        if context.role not in roles and not context.user.is_super_admin:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return context

    return dependency
