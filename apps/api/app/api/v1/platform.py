import re
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import token_urlsafe
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit_log import record_audit
from app.db import get_db
from app.dependencies import get_current_user
from app.models import (
    Conversation,
    Document,
    Invitation,
    KnowledgeBase,
    Tenant,
    TenantMembership,
    TenantRole,
    User,
)

router = APIRouter(prefix="/platform", tags=["platform administration"])


class TenantCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    owner_email: EmailStr


class TenantUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    is_active: bool | None = None


def require_super_admin(user: User) -> None:
    if not user.is_super_admin:
        raise HTTPException(status_code=403, detail="Platform administrator access required")


def slugify(value: str) -> str:
    return (re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "workspace")[:60]


@router.get("/overview")
async def platform_overview(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    require_super_admin(user)
    return {
        "tenants": await db.scalar(
            select(func.count(Tenant.id)).where(Tenant.slug != "lumix-platform-internal")
        ),
        "active_tenants": await db.scalar(
            select(func.count(Tenant.id)).where(
                Tenant.is_active.is_(True), Tenant.slug != "lumix-platform-internal"
            )
        ),
        "users": await db.scalar(select(func.count(User.id))),
        "knowledge_bases": await db.scalar(
            select(func.count(KnowledgeBase.id)).where(KnowledgeBase.is_active.is_(True))
        ),
        "documents": await db.scalar(select(func.count(Document.id))),
        "conversations": await db.scalar(select(func.count(Conversation.id))),
    }


@router.get("/tenants")
async def list_tenants(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    require_super_admin(user)
    tenants = await db.scalars(
        select(Tenant)
        .where(Tenant.slug != "lumix-platform-internal")
        .order_by(Tenant.created_at.desc())
    )
    result = []
    for tenant in tenants:
        user_count = await db.scalar(
            select(func.count(TenantMembership.id)).where(
                TenantMembership.tenant_id == tenant.id, TenantMembership.is_active.is_(True)
            )
        )
        result.append(
            {
                "id": str(tenant.id),
                "name": tenant.name,
                "slug": tenant.slug,
                "is_active": tenant.is_active,
                "created_at": tenant.created_at,
                "active_users": user_count,
            }
        )
    return result


@router.post("/tenants", status_code=status.HTTP_201_CREATED)
async def create_tenant(
    payload: TenantCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(user)
    base = slugify(payload.name)
    slug, suffix = base, 2
    while await db.scalar(select(Tenant.id).where(Tenant.slug == slug)):
        slug, suffix = f"{base[:56]}-{suffix}", suffix + 1
    tenant = Tenant(name=payload.name.strip(), slug=slug)
    db.add(tenant)
    await db.flush()
    owner = await db.scalar(select(User).where(User.email == str(payload.owner_email).lower()))
    invitation_token = None
    if owner:
        db.add(TenantMembership(tenant_id=tenant.id, user_id=owner.id, role=TenantRole.owner))
    else:
        invitation_token = token_urlsafe(36)
        db.add(
            Invitation(
                tenant_id=tenant.id,
                email=str(payload.owner_email).lower(),
                role=TenantRole.owner,
                token_hash=sha256(invitation_token.encode()).hexdigest(),
                invited_by=user.id,
                expires_at=datetime.now(timezone.utc) + timedelta(days=7),
            )
        )
    record_audit(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        action="tenant.created",
        resource_type="tenant",
        resource_id=tenant.id,
    )
    await db.commit()
    return {
        "id": str(tenant.id),
        "name": tenant.name,
        "slug": tenant.slug,
        "owner_email": str(payload.owner_email).lower(),
        "invitation_token": invitation_token,
    }


@router.patch("/tenants/{tenant_id}")
async def update_tenant(
    tenant_id: UUID,
    payload: TenantUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(user)
    tenant = await db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(tenant, key, value.strip() if key == "name" and value else value)
    record_audit(
        db,
        tenant_id=tenant.id,
        actor_user_id=user.id,
        action="tenant.updated",
        resource_type="tenant",
        resource_id=tenant.id,
    )
    await db.commit()
    return {
        "id": str(tenant.id),
        "name": tenant.name,
        "slug": tenant.slug,
        "is_active": tenant.is_active,
    }
