from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.knowledge_bases import accessible_kb
from app.db import get_db
from app.dependencies import CurrentContext, get_current_context
from app.models import AIProfile, AIProvider
from app.schemas import AIProfileUpdate

router = APIRouter(prefix="/ai/profile", tags=["AI personalization"])


def profile_output(profile: AIProfile) -> dict:
    return {
        key: getattr(profile, key)
        for key in (
            "id",
            "assistant_name",
            "personality",
            "language",
            "tone",
            "answer_length",
            "technical_level",
            "preferred_format",
            "custom_instructions",
            "preferred_provider_id",
            "default_knowledge_base_ids",
            "memory_enabled",
            "updated_at",
        )
    }


@router.get("")
async def get_profile(
    context: CurrentContext = Depends(get_current_context), db: AsyncSession = Depends(get_db)
):
    profile = await db.scalar(
        select(AIProfile).where(
            AIProfile.tenant_id == context.tenant.id, AIProfile.user_id == context.user.id
        )
    )
    if not profile:
        await db.execute(
            insert(AIProfile)
            .values(tenant_id=context.tenant.id, user_id=context.user.id)
            .on_conflict_do_nothing(constraint="uq_ai_profile_tenant_user")
        )
        await db.commit()
        profile = await db.scalar(
            select(AIProfile).where(
                AIProfile.tenant_id == context.tenant.id,
                AIProfile.user_id == context.user.id,
            )
        )
    return profile_output(profile)


@router.put("")
async def update_profile(
    payload: AIProfileUpdate,
    context: CurrentContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    default_ids = list(dict.fromkeys(payload.default_knowledge_base_ids))
    for kb_id in default_ids:
        await accessible_kb(kb_id, context, db)
    if payload.preferred_provider_id:
        provider = await db.scalar(
            select(AIProvider.id).where(
                AIProvider.id == payload.preferred_provider_id,
                AIProvider.tenant_id == context.tenant.id,
                AIProvider.kind == "llm",
                AIProvider.is_active.is_(True),
            )
        )
        if not provider:
            raise HTTPException(
                status_code=422,
                detail="Preferred provider must be an active LLM provider in this organization",
            )
    profile = await db.scalar(
        select(AIProfile).where(
            AIProfile.tenant_id == context.tenant.id, AIProfile.user_id == context.user.id
        )
    )
    if not profile:
        await db.execute(
            insert(AIProfile)
            .values(tenant_id=context.tenant.id, user_id=context.user.id)
            .on_conflict_do_nothing(constraint="uq_ai_profile_tenant_user")
        )
        profile = await db.scalar(
            select(AIProfile).where(
                AIProfile.tenant_id == context.tenant.id,
                AIProfile.user_id == context.user.id,
            )
        )
    values = payload.model_dump()
    values["default_knowledge_base_ids"] = [str(item) for item in default_ids]
    for key, value in values.items():
        setattr(profile, key, value)
    await db.commit()
    await db.refresh(profile)
    return profile_output(profile)
