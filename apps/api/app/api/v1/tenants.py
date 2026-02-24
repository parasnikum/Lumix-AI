from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import token_urlsafe

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit_log import record_audit
from app.db import get_db
from app.dependencies import CurrentContext, get_current_context, require_roles
from app.models import AuditLog, Invitation, Tenant, TenantMembership, TenantRole, User
from app.schemas import InvitationCreate, MemberUpdate, TenantOut

router = APIRouter(prefix="/tenants", tags=["tenants"])
MANAGERS = (TenantRole.owner, TenantRole.admin)


@router.get("/current", response_model=TenantOut)
async def current_tenant(context: CurrentContext = Depends(get_current_context)):
    return context.tenant


@router.get("/current/users")
async def list_members(
    context: CurrentContext = Depends(
        require_roles(TenantRole.owner, TenantRole.admin, TenantRole.knowledge_manager)
    ),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        select(
            User.id, User.email, User.full_name, TenantMembership.role, TenantMembership.is_active
        )
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .where(TenantMembership.tenant_id == context.tenant.id)
        .order_by(User.full_name)
    )
    return [
        {
            "id": str(r.id),
            "email": r.email,
            "full_name": r.full_name,
            "role": r.role.value,
            "is_active": r.is_active,
            "is_current_user": r.id == context.user.id,
            "can_transfer_ownership": context.role == TenantRole.owner
            and r.id != context.user.id
            and r.is_active,
            "can_invite": context.role in (TenantRole.owner, TenantRole.admin),
            "can_manage_members": context.role in (TenantRole.owner, TenantRole.admin),
            "can_invite_admin": context.role == TenantRole.owner,
        }
        for r in rows
    ]


@router.post("/current/invitations", status_code=status.HTTP_201_CREATED)
async def create_invitation(
    payload: InvitationCreate,
    context: CurrentContext = Depends(require_roles(*MANAGERS)),
    db: AsyncSession = Depends(get_db),
):
    email = str(payload.email).lower()
    if payload.role == "admin" and context.role != TenantRole.owner:
        raise HTTPException(
            status_code=403, detail="Only the organization owner can invite administrators"
        )
    existing = await db.scalar(
        select(TenantMembership.id)
        .join(User, User.id == TenantMembership.user_id)
        .where(
            TenantMembership.tenant_id == context.tenant.id,
            User.email == email,
            TenantMembership.is_active.is_(True),
        )
    )
    if existing:
        raise HTTPException(
            status_code=409, detail="This person is already a member of the organization"
        )
    pending = await db.scalar(
        select(Invitation.id).where(
            Invitation.tenant_id == context.tenant.id,
            Invitation.email == email,
            Invitation.accepted_at.is_(None),
            Invitation.expires_at > datetime.now(timezone.utc),
        )
    )
    if pending:
        raise HTTPException(
            status_code=409, detail="An active invitation already exists for this email"
        )
    token = token_urlsafe(36)
    invitation = Invitation(
        tenant_id=context.tenant.id,
        email=email,
        role=TenantRole(payload.role),
        token_hash=sha256(token.encode()).hexdigest(),
        invited_by=context.user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.add(invitation)
    record_audit(
        db,
        tenant_id=context.tenant.id,
        actor_user_id=context.user.id,
        action="invitation.created",
        resource_type="invitation",
        resource_id=invitation.id,
    )
    await db.commit()
    return {
        "email": email,
        "role": payload.role,
        "invitation_token": token,
        "expires_at": invitation.expires_at,
    }


@router.patch("/current/users/{user_id}")
async def update_member(
    user_id: str,
    payload: MemberUpdate,
    context: CurrentContext = Depends(require_roles(*MANAGERS)),
    db: AsyncSession = Depends(get_db),
):
    from uuid import UUID

    try:
        target_id = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Member not found")
    membership = await db.scalar(
        select(TenantMembership).where(
            TenantMembership.tenant_id == context.tenant.id, TenantMembership.user_id == target_id
        )
    )
    if not membership:
        raise HTTPException(status_code=404, detail="Member not found")
    if membership.role == TenantRole.owner and context.role != TenantRole.owner:
        raise HTTPException(
            status_code=403, detail="Only the organization owner can manage an owner"
        )
    if context.role == TenantRole.admin and membership.role == TenantRole.admin:
        raise HTTPException(
            status_code=403, detail="Administrators cannot manage other administrators"
        )
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("role") == "admin" and context.role != TenantRole.owner:
        raise HTTPException(
            status_code=403, detail="Only the organization owner can assign administrator access"
        )
    owner_count = await db.scalar(
        select(func.count(TenantMembership.id)).where(
            TenantMembership.tenant_id == context.tenant.id,
            TenantMembership.role == TenantRole.owner,
            TenantMembership.is_active.is_(True),
        )
    )
    if (
        membership.role == TenantRole.owner
        and (changes.get("role") not in (None, "owner") or changes.get("is_active") is False)
        and owner_count <= 1
    ):
        raise HTTPException(
            status_code=409, detail="Transfer ownership before removing the only active owner"
        )
    if changes.get("role"):
        membership.role = TenantRole(changes["role"])
    if "is_active" in changes:
        membership.is_active = changes["is_active"]
    record_audit(
        db,
        tenant_id=context.tenant.id,
        actor_user_id=context.user.id,
        action="member.updated",
        resource_type="membership",
        resource_id=membership.id,
    )
    await db.commit()
    return {
        "user_id": str(target_id),
        "role": membership.role.value,
        "is_active": membership.is_active,
    }


@router.post("/current/transfer-ownership/{user_id}")
async def transfer_ownership(
    user_id: str,
    context: CurrentContext = Depends(require_roles(TenantRole.owner)),
    db: AsyncSession = Depends(get_db),
):
    from uuid import UUID

    try:
        target_id = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Member not found")
    if target_id == context.user.id:
        raise HTTPException(status_code=422, detail="Choose another organization member")
    await db.scalar(select(Tenant).where(Tenant.id == context.tenant.id).with_for_update())
    target = await db.scalar(
        select(TenantMembership).where(
            TenantMembership.tenant_id == context.tenant.id,
            TenantMembership.user_id == target_id,
            TenantMembership.is_active.is_(True),
        )
    )
    current = await db.scalar(
        select(TenantMembership)
        .where(
            TenantMembership.tenant_id == context.tenant.id,
            TenantMembership.user_id == context.user.id,
            TenantMembership.is_active.is_(True),
        )
        .with_for_update()
    )
    if not target or not current or current.role != TenantRole.owner:
        raise HTTPException(status_code=404, detail="Active organization member not found")
    target.role = TenantRole.owner
    current.role = TenantRole.admin
    record_audit(
        db,
        tenant_id=context.tenant.id,
        actor_user_id=context.user.id,
        action="tenant.ownership_transferred",
        resource_type="membership",
        resource_id=target.id,
    )
    await db.commit()
    return {"new_owner_user_id": str(target_id), "previous_owner_role": "admin"}


@router.get("/current/audit-logs")
async def list_audit_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    context: CurrentContext = Depends(require_roles(TenantRole.owner, TenantRole.admin)),
    db: AsyncSession = Depends(get_db),
):
    filters = AuditLog.tenant_id == context.tenant.id
    total = await db.scalar(select(func.count(AuditLog.id)).where(filters)) or 0
    total_pages = (total + page_size - 1) // page_size
    if total_pages and page > total_pages:
        page = total_pages
    offset = (page - 1) * page_size
    rows = await db.execute(
        select(AuditLog, User.full_name, User.email)
        .outerjoin(User, User.id == AuditLog.actor_user_id)
        .where(filters)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(page_size)
        .offset(offset)
    )
    items = [
        {
            "id": str(row.AuditLog.id),
            "action": row.AuditLog.action,
            "resource_type": row.AuditLog.resource_type,
            "resource_id": row.AuditLog.resource_id,
            "actor_name": row.full_name,
            "actor_email": row.email,
            "created_at": row.AuditLog.created_at,
        }
        for row in rows
    ]
    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "has_previous": page > 1,
        "has_next": page < total_pages,
    }


@router.patch("/current", response_model=TenantOut)
async def update_current_tenant(
    payload: dict,
    context: CurrentContext = Depends(require_roles(TenantRole.owner, TenantRole.admin)),
    db: AsyncSession = Depends(get_db),
):
    name = payload.get("name")
    if not isinstance(name, str) or not 2 <= len(name.strip()) <= 160:
        raise HTTPException(
            status_code=422, detail="Organization name must be between 2 and 160 characters"
        )
    context.tenant.name = name.strip()
    record_audit(
        db,
        tenant_id=context.tenant.id,
        actor_user_id=context.user.id,
        action="tenant.updated",
        resource_type="tenant",
        resource_id=context.tenant.id,
    )
    await db.commit()
    await db.refresh(context.tenant)
    return context.tenant
