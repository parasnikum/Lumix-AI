import re
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from uuid import UUID, uuid4

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db import get_db
from app.dependencies import get_current_user
from app.models import Invitation, Tenant, TenantMembership, TenantRole, User, UserSession
from app.schemas import (
    AuthResponse,
    InvitationAccept,
    LoginRequest,
    RegisterRequest,
    TenantOut,
    UserOut,
)
from app.security import (
    create_access_token,
    create_refresh_token,
    decode_token_claims,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["authentication"])


def slugify(value: str) -> str:
    return (re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "workspace")[:60]


def set_session_cookies(response: Response, access: str, refresh: str) -> None:
    secure = settings.is_production
    response.set_cookie(
        "lumix_access",
        access,
        httponly=True,
        secure=secure,
        samesite="strict",
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )
    response.set_cookie(
        "lumix_refresh",
        refresh,
        httponly=True,
        secure=secure,
        samesite="strict",
        max_age=settings.refresh_token_expire_days * 86400,
        path="/",
    )


async def issue_session(
    user: User, tenant: Tenant, db: AsyncSession, response: Response
) -> AuthResponse:
    session_id, jti = uuid4(), str(uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    db.add(
        UserSession(
            id=session_id,
            user_id=user.id,
            tenant_id=tenant.id,
            refresh_jti=jti,
            expires_at=expires_at,
        )
    )
    await db.commit()
    access = create_access_token(user.id, tenant.id, session_id)
    refresh = create_refresh_token(user.id, tenant.id, session_id, jti)
    set_session_cookies(response, access, refresh)
    return AuthResponse(user=UserOut.model_validate(user), tenant=TenantOut.model_validate(tenant))


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest, response: Response, db: AsyncSession = Depends(get_db)
):
    email = str(payload.email).lower()
    if await db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    base = slugify(payload.organization_name)
    slug, suffix = base, 2
    while await db.scalar(select(Tenant.id).where(Tenant.slug == slug)):
        slug, suffix = f"{base[:56]}-{suffix}", suffix + 1
    user = User(
        email=email,
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
    )
    tenant = Tenant(name=payload.organization_name.strip(), slug=slug)
    db.add_all([user, tenant])
    await db.flush()
    db.add(TenantMembership(user_id=user.id, tenant_id=tenant.id, role=TenantRole.owner))
    await db.commit()
    await db.refresh(user)
    await db.refresh(tenant)
    return await issue_session(user, tenant, db, response)


@router.post("/accept-invitation", response_model=AuthResponse)
async def accept_invitation(
    payload: InvitationAccept, response: Response, db: AsyncSession = Depends(get_db)
):
    token_hash = sha256(payload.token.encode()).hexdigest()
    invitation = await db.scalar(
        select(Invitation)
        .where(
            Invitation.token_hash == token_hash,
            Invitation.accepted_at.is_(None),
            Invitation.expires_at > datetime.now(timezone.utc),
        )
        .with_for_update()
    )
    if not invitation:
        raise HTTPException(status_code=400, detail="Invitation is invalid or expired")
    user = await db.scalar(select(User).where(User.email == invitation.email))
    if user:
        if not user.is_active or not verify_password(payload.password, user.password_hash):
            raise HTTPException(
                status_code=401,
                detail="This email already has an account. Sign in with its existing password before accepting.",
            )
    else:
        user = User(
            email=invitation.email,
            full_name=payload.full_name.strip(),
            password_hash=hash_password(payload.password),
        )
        db.add(user)
        await db.flush()
    existing_membership = await db.scalar(
        select(TenantMembership).where(
            TenantMembership.tenant_id == invitation.tenant_id,
            TenantMembership.user_id == user.id,
        )
    )
    if existing_membership and existing_membership.is_active:
        raise HTTPException(
            status_code=409, detail="This account already belongs to the organization"
        )
    tenant = await db.get(Tenant, invitation.tenant_id)
    if not tenant or not tenant.is_active:
        raise HTTPException(status_code=400, detail="Organization is no longer active")
    if existing_membership:
        existing_membership.is_active = True
        existing_membership.role = invitation.role
    else:
        db.add(TenantMembership(user_id=user.id, tenant_id=tenant.id, role=invitation.role))
    invitation.accepted_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)
    return await issue_session(user, tenant, db, response)


@router.get("/workspaces")
async def list_workspaces(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    rows = await db.execute(
        select(Tenant.id, Tenant.name, Tenant.slug, TenantMembership.role)
        .join(TenantMembership, TenantMembership.tenant_id == Tenant.id)
        .where(
            TenantMembership.user_id == user.id,
            TenantMembership.is_active.is_(True),
            Tenant.is_active.is_(True),
        )
        .order_by(Tenant.name)
    )
    return [
        {"id": str(row.id), "name": row.name, "slug": row.slug, "role": row.role.value}
        for row in rows
    ]


@router.post("/switch-tenant/{tenant_id}", response_model=AuthResponse)
async def switch_tenant(
    tenant_id: UUID,
    request: Request,
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    membership = await db.scalar(
        select(TenantMembership).where(
            TenantMembership.user_id == user.id,
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.is_active.is_(True),
        )
    )
    tenant = await db.get(Tenant, tenant_id)
    if not membership or not tenant or not tenant.is_active:
        raise HTTPException(status_code=403, detail="You do not have access to this organization")
    access_token = request.cookies.get("lumix_access")
    if access_token:
        try:
            claims = decode_token_claims(access_token)
            current_session = await db.get(UserSession, UUID(claims["sid"]))
            if (
                current_session
                and current_session.user_id == user.id
                and current_session.revoked_at is None
            ):
                current_session.revoked_at = datetime.now(timezone.utc)
                await db.commit()
        except (jwt.InvalidTokenError, ValueError, KeyError):
            pass
    return await issue_session(user, tenant, db, response)


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.email == str(payload.email).lower()))
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    membership = await db.scalar(
        select(TenantMembership)
        .join(Tenant, Tenant.id == TenantMembership.tenant_id)
        .where(
            TenantMembership.user_id == user.id,
            TenantMembership.is_active.is_(True),
            Tenant.is_active.is_(True),
        )
        .order_by(Tenant.created_at.asc())
    )
    if not membership:
        raise HTTPException(status_code=403, detail="No active organization membership")
    tenant = await db.get(Tenant, membership.tenant_id)
    return await issue_session(user, tenant, db, response)


@router.post("/refresh")
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    token = request.cookies.get("lumix_refresh")
    if not token:
        raise HTTPException(status_code=401, detail="Refresh session is missing")
    origin = request.headers.get("origin")
    if origin and origin not in settings.cors_origins:
        raise HTTPException(status_code=403, detail="Request origin is not allowed")
    try:
        claims = decode_token_claims(token, "refresh")
    except (jwt.InvalidTokenError, ValueError, KeyError):
        raise HTTPException(status_code=401, detail="Refresh session is invalid or expired")
    user_id = UUID(claims["sub"])
    tenant_id = UUID(claims["tenant_id"])
    user = await db.scalar(select(User).where(User.id == user_id, User.is_active.is_(True)))
    tenant = await db.get(Tenant, tenant_id)
    membership = await db.scalar(
        select(TenantMembership).where(
            TenantMembership.user_id == user_id,
            TenantMembership.tenant_id == tenant_id,
            TenantMembership.is_active.is_(True),
        )
    )
    if not user or not tenant or not tenant.is_active or not membership:
        raise HTTPException(status_code=401, detail="Organization membership is no longer active")

    new_jti = str(uuid4())
    from sqlalchemy import update

    rotated = await db.execute(
        update(UserSession)
        .where(
            UserSession.id == claims["sid"],
            UserSession.user_id == claims["sub"],
            UserSession.tenant_id == claims["tenant_id"],
            UserSession.refresh_jti == claims["jti"],
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > datetime.now(timezone.utc),
        )
        .values(refresh_jti=new_jti)
        .returning(UserSession.id)
    )
    session_id = rotated.scalar_one_or_none()
    if not session_id:
        raise HTTPException(status_code=401, detail="Refresh token was already used or revoked")
    await db.commit()
    access = create_access_token(UUID(claims["sub"]), UUID(claims["tenant_id"]), session_id)
    refresh_token = create_refresh_token(
        UUID(claims["sub"]), UUID(claims["tenant_id"]), session_id, new_jti
    )
    set_session_cookies(response, access, refresh_token)
    return {"status": "refreshed"}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    token = request.cookies.get("lumix_refresh")
    if token:
        try:
            claims = decode_token_claims(token, "refresh")
            session = await db.get(UserSession, UUID(claims["sid"]))
            if session and session.refresh_jti == claims["jti"] and session.revoked_at is None:
                session.revoked_at = datetime.now(timezone.utc)
                await db.commit()
        except (jwt.InvalidTokenError, ValueError, KeyError):
            pass
    response.delete_cookie("lumix_access", path="/", httponly=True, samesite="strict")
    response.delete_cookie("lumix_refresh", path="/", httponly=True, samesite="strict")
    return None


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user
