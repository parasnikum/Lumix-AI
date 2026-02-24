from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit_log import record_audit
from app.db import get_db
from app.dependencies import CurrentContext, get_current_context, require_roles
from app.models import (
    AIProvider,
    Document,
    KnowledgeBase,
    KnowledgeBaseAccess,
    TenantMembership,
    TenantRole,
    User,
)
from app.schemas import (
    KnowledgeBaseCreate,
    KnowledgeBaseOut,
    KnowledgeBaseUpdate,
    KnowledgeBaseUserPermission,
)

router = APIRouter(prefix="/knowledge-bases", tags=["knowledge bases"])
MANAGERS = {TenantRole.owner, TenantRole.admin, TenantRole.knowledge_manager}


async def accessible_kb(
    kb_id: UUID, context: CurrentContext, db: AsyncSession, manage: bool = False
) -> KnowledgeBase:
    kb = await db.scalar(
        select(KnowledgeBase).where(
            KnowledgeBase.id == kb_id,
            KnowledgeBase.tenant_id == context.tenant.id,
            KnowledgeBase.is_active.is_(True),
        )
    )
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    if context.role in MANAGERS or context.user.is_super_admin:
        return kb
    if kb.visibility == "tenant" and not manage:
        return kb
    access = await db.scalar(
        select(KnowledgeBaseAccess).where(
            KnowledgeBaseAccess.tenant_id == context.tenant.id,
            KnowledgeBaseAccess.knowledge_base_id == kb.id,
            KnowledgeBaseAccess.user_id == context.user.id,
        )
    )
    if not access or (manage and not access.can_manage):
        raise HTTPException(status_code=403, detail="Knowledge base access denied")
    return kb


@router.get("", response_model=list[KnowledgeBaseOut])
async def list_knowledge_bases(
    context: CurrentContext = Depends(get_current_context), db: AsyncSession = Depends(get_db)
):
    query = select(KnowledgeBase).where(
        KnowledgeBase.tenant_id == context.tenant.id, KnowledgeBase.is_active.is_(True)
    )
    if context.role not in MANAGERS and not context.user.is_super_admin:
        allowed = select(KnowledgeBaseAccess.knowledge_base_id).where(
            KnowledgeBaseAccess.tenant_id == context.tenant.id,
            KnowledgeBaseAccess.user_id == context.user.id,
        )
        query = query.where(
            or_(KnowledgeBase.visibility == "tenant", KnowledgeBase.id.in_(allowed))
        )
    return list((await db.scalars(query.order_by(KnowledgeBase.created_at.desc()))).all())


@router.post("", response_model=KnowledgeBaseOut, status_code=status.HTTP_201_CREATED)
async def create_knowledge_base(
    payload: KnowledgeBaseCreate,
    context: CurrentContext = Depends(require_roles(*MANAGERS)),
    db: AsyncSession = Depends(get_db),
):
    if payload.chunk_overlap >= payload.chunk_size:
        raise HTTPException(status_code=422, detail="Chunk overlap must be smaller than chunk size")
    if payload.visibility not in {"tenant", "restricted"}:
        raise HTTPException(status_code=422, detail="Visibility must be tenant or restricted")
    embedding_provider = None
    if payload.embedding_provider_id:
        embedding_provider = await db.scalar(
            select(AIProvider).where(
                AIProvider.id == payload.embedding_provider_id,
                AIProvider.tenant_id == context.tenant.id,
                AIProvider.kind == "embedding",
                AIProvider.is_active.is_(True),
            )
        )
        if not embedding_provider:
            raise HTTPException(
                status_code=422, detail="Select an active embedding provider from this organization"
            )
    values = payload.model_dump(exclude={"embedding_provider_id"})
    kb = KnowledgeBase(
        tenant_id=context.tenant.id,
        created_by=context.user.id,
        embedding_provider_id=embedding_provider.id if embedding_provider else None,
        embedding_model=embedding_provider.model if embedding_provider else "all-MiniLM-L6-v2",
        **values,
    )
    db.add(kb)
    await db.flush()
    db.add(
        KnowledgeBaseAccess(
            tenant_id=context.tenant.id,
            knowledge_base_id=kb.id,
            user_id=context.user.id,
            can_manage=True,
        )
    )
    record_audit(
        db,
        tenant_id=context.tenant.id,
        actor_user_id=context.user.id,
        action="knowledge_base.created",
        resource_type="knowledge_base",
        resource_id=kb.id,
    )
    await db.commit()
    await db.refresh(kb)
    return kb


@router.get("/{kb_id}", response_model=KnowledgeBaseOut)
async def get_knowledge_base(
    kb_id: UUID,
    context: CurrentContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    return await accessible_kb(kb_id, context, db)


@router.patch("/{kb_id}", response_model=KnowledgeBaseOut)
async def update_knowledge_base(
    kb_id: UUID,
    payload: KnowledgeBaseUpdate,
    context: CurrentContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    kb = await accessible_kb(kb_id, context, db, manage=True)
    changes = payload.model_dump(exclude_unset=True)
    next_chunk_size = changes.get("chunk_size", kb.chunk_size)
    next_chunk_overlap = changes.get("chunk_overlap", kb.chunk_overlap)
    if next_chunk_overlap >= next_chunk_size:
        raise HTTPException(status_code=422, detail="Chunk overlap must be smaller than chunk size")
    embedding_change = (
        "embedding_provider_id" in changes
        and changes["embedding_provider_id"] != kb.embedding_provider_id
    )
    chunking_change = any(
        key in changes and changes[key] != getattr(kb, key)
        for key in ("chunk_size", "chunk_overlap")
    )
    if embedding_change or chunking_change:
        document_count = await db.scalar(
            select(func.count(Document.id)).where(
                Document.tenant_id == context.tenant.id,
                Document.knowledge_base_id == kb.id,
            )
        )
        if document_count:
            raise HTTPException(
                status_code=409,
                detail="Embedding and chunking settings are locked after documents are added. Create a new knowledge base to use different indexing settings.",
            )
    if "embedding_provider_id" in changes:
        provider = None
        if changes["embedding_provider_id"]:
            provider = await db.scalar(
                select(AIProvider).where(
                    AIProvider.id == changes["embedding_provider_id"],
                    AIProvider.tenant_id == context.tenant.id,
                    AIProvider.kind == "embedding",
                    AIProvider.is_active.is_(True),
                )
            )
            if not provider:
                raise HTTPException(
                    status_code=422,
                    detail="Select an active embedding provider from this organization",
                )
        changes["embedding_model"] = provider.model if provider else "all-MiniLM-L6-v2"
        changes["embedding_dimensions"] = None
    if changes.get("visibility") not in (None, "tenant", "restricted"):
        raise HTTPException(status_code=422, detail="Visibility must be tenant or restricted")
    for key, value in changes.items():
        setattr(kb, key, value)
    record_audit(
        db,
        tenant_id=context.tenant.id,
        actor_user_id=context.user.id,
        action="knowledge_base.updated",
        resource_type="knowledge_base",
        resource_id=kb.id,
    )
    await db.commit()
    await db.refresh(kb)
    return kb


@router.get("/{kb_id}/users")
async def list_knowledge_base_users(
    kb_id: UUID,
    context: CurrentContext = Depends(require_roles(*MANAGERS)),
    db: AsyncSession = Depends(get_db),
):
    await accessible_kb(kb_id, context, db, manage=True)
    rows = await db.execute(
        select(User.id, User.email, User.full_name, KnowledgeBaseAccess.can_manage)
        .join(KnowledgeBaseAccess, KnowledgeBaseAccess.user_id == User.id)
        .join(
            TenantMembership,
            (TenantMembership.user_id == User.id)
            & (TenantMembership.tenant_id == context.tenant.id)
            & TenantMembership.is_active.is_(True),
        )
        .where(
            KnowledgeBaseAccess.tenant_id == context.tenant.id,
            KnowledgeBaseAccess.knowledge_base_id == kb_id,
        )
        .order_by(User.full_name)
    )
    return [
        {
            "user_id": str(r.id),
            "email": r.email,
            "full_name": r.full_name,
            "can_manage": r.can_manage,
        }
        for r in rows
    ]


@router.put("/{kb_id}/users")
async def replace_knowledge_base_users(
    kb_id: UUID,
    assignments: list[KnowledgeBaseUserPermission],
    context: CurrentContext = Depends(require_roles(*MANAGERS)),
    db: AsyncSession = Depends(get_db),
):
    await accessible_kb(kb_id, context, db, manage=True)
    user_ids = [item.user_id for item in assignments]
    if len(user_ids) != len(set(user_ids)):
        raise HTTPException(status_code=422, detail="A user can only be assigned once")
    if user_ids:
        active_ids = set(
            (
                await db.scalars(
                    select(TenantMembership.user_id).where(
                        TenantMembership.tenant_id == context.tenant.id,
                        TenantMembership.user_id.in_(user_ids),
                        TenantMembership.is_active.is_(True),
                    )
                )
            ).all()
        )
        if active_ids != set(user_ids):
            raise HTTPException(
                status_code=422,
                detail="Every assigned user must be an active member of this organization",
            )
    await db.execute(
        delete(KnowledgeBaseAccess).where(
            KnowledgeBaseAccess.tenant_id == context.tenant.id,
            KnowledgeBaseAccess.knowledge_base_id == kb_id,
        )
    )
    db.add_all(
        [
            KnowledgeBaseAccess(
                tenant_id=context.tenant.id,
                knowledge_base_id=kb_id,
                user_id=item.user_id,
                can_manage=item.can_manage,
            )
            for item in assignments
        ]
    )
    record_audit(
        db,
        tenant_id=context.tenant.id,
        actor_user_id=context.user.id,
        action="knowledge_base.access_updated",
        resource_type="knowledge_base",
        resource_id=kb_id,
    )
    await db.commit()
    return {"knowledge_base_id": str(kb_id), "assigned_users": len(assignments)}


@router.delete("/{kb_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_base(
    kb_id: UUID,
    context: CurrentContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    kb = await accessible_kb(kb_id, context, db, manage=True)
    kb.is_active = False
    record_audit(
        db,
        tenant_id=context.tenant.id,
        actor_user_id=context.user.id,
        action="knowledge_base.archived",
        resource_type="knowledge_base",
        resource_id=kb.id,
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
