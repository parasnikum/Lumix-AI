from urllib.parse import urlparse
from uuid import UUID

import httpx
from cryptography.fernet import InvalidToken
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit_log import record_audit
from app.db import get_db
from app.dependencies import CurrentContext, get_current_context, require_roles
from app.models import AIProvider, KnowledgeBase, TenantRole
from app.schemas import AIProviderCreate, AIProviderUpdate
from app.secrets import encrypt_secret

router = APIRouter(prefix="/ai/providers", tags=["AI providers"])
MANAGERS = (TenantRole.owner, TenantRole.admin)


def validate_base_url(value: str) -> str:
    parsed = urlparse(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise HTTPException(
            status_code=422, detail="Provider URL must be a clean HTTP or HTTPS base URL"
        )
    if parsed.scheme == "http" and parsed.hostname not in {
        "localhost",
        "127.0.0.1",
        "host.docker.internal",
        "ollama",
    }:
        raise HTTPException(status_code=422, detail="Use HTTPS for remote AI providers")
    return value.rstrip("/")


def provider_output(provider: AIProvider) -> dict:
    return {
        "id": str(provider.id),
        "kind": provider.kind,
        "name": provider.name,
        "base_url": provider.base_url,
        "model": provider.model,
        "api_key_configured": bool(provider.api_key_encrypted),
        "temperature": provider.temperature,
        "max_tokens": provider.max_tokens,
        "timeout_seconds": provider.timeout_seconds,
        "is_active": provider.is_active,
        "created_at": provider.created_at,
    }


@router.get("")
async def list_providers(
    context: CurrentContext = Depends(get_current_context), db: AsyncSession = Depends(get_db)
):
    rows = await db.scalars(
        select(AIProvider)
        .where(AIProvider.tenant_id == context.tenant.id)
        .order_by(AIProvider.created_at.desc())
    )
    return [provider_output(item) for item in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_provider(
    payload: AIProviderCreate,
    context: CurrentContext = Depends(require_roles(*MANAGERS)),
    db: AsyncSession = Depends(get_db),
):
    provider = AIProvider(
        tenant_id=context.tenant.id,
        kind=payload.kind,
        name=payload.name.strip(),
        base_url=validate_base_url(payload.base_url),
        model=payload.model.strip(),
        api_key_encrypted=encrypt_secret(payload.api_key) if payload.api_key else None,
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
        timeout_seconds=payload.timeout_seconds,
    )
    db.add(provider)
    record_audit(
        db,
        tenant_id=context.tenant.id,
        actor_user_id=context.user.id,
        action="ai_provider.created",
        resource_type="ai_provider",
        resource_id=provider.id,
    )
    await db.commit()
    await db.refresh(provider)
    return provider_output(provider)


@router.patch("/{provider_id}")
async def update_provider(
    provider_id: UUID,
    payload: AIProviderUpdate,
    context: CurrentContext = Depends(require_roles(*MANAGERS)),
    db: AsyncSession = Depends(get_db),
):
    provider = await db.scalar(
        select(AIProvider).where(
            AIProvider.id == provider_id, AIProvider.tenant_id == context.tenant.id
        )
    )
    if not provider:
        raise HTTPException(status_code=404, detail="AI provider not found")
    changes = payload.model_dump(exclude_unset=True)
    if provider.kind == "embedding":
        provider_is_referenced = await db.scalar(
            select(KnowledgeBase.id).where(
                KnowledgeBase.tenant_id == context.tenant.id,
                KnowledgeBase.embedding_provider_id == provider.id,
            )
        )
        if provider_is_referenced and ({"model", "base_url"} & changes.keys()):
            raise HTTPException(
                status_code=409,
                detail="This embedding provider is in use. Create a new provider and re-index knowledge bases before changing its model or endpoint.",
            )
        if provider_is_referenced and changes.get("is_active") is False:
            raise HTTPException(
                status_code=409,
                detail="This embedding provider is assigned to a knowledge base. Change the knowledge base provider before disabling it.",
            )
    if "base_url" in changes and changes["base_url"]:
        changes["base_url"] = validate_base_url(changes["base_url"])
    if "api_key" in changes:
        changes["api_key_encrypted"] = (
            encrypt_secret(changes.pop("api_key")) if changes["api_key"] else None
        )
    for key, value in changes.items():
        setattr(provider, key, value)
    record_audit(
        db,
        tenant_id=context.tenant.id,
        actor_user_id=context.user.id,
        action="ai_provider.updated",
        resource_type="ai_provider",
        resource_id=provider.id,
    )
    await db.commit()
    await db.refresh(provider)
    return provider_output(provider)


@router.delete("/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(
    provider_id: UUID,
    context: CurrentContext = Depends(require_roles(*MANAGERS)),
    db: AsyncSession = Depends(get_db),
):
    provider = await db.scalar(
        select(AIProvider).where(
            AIProvider.id == provider_id, AIProvider.tenant_id == context.tenant.id
        )
    )
    if not provider:
        raise HTTPException(status_code=404, detail="AI provider not found")
    if provider.kind == "embedding":
        is_referenced = await db.scalar(
            select(KnowledgeBase.id).where(
                KnowledgeBase.tenant_id == context.tenant.id,
                KnowledgeBase.embedding_provider_id == provider.id,
            )
        )
        if is_referenced:
            raise HTTPException(
                status_code=409,
                detail="This embedding provider is assigned to a knowledge base. Change the knowledge base provider before deleting it.",
            )
    record_audit(
        db,
        tenant_id=context.tenant.id,
        actor_user_id=context.user.id,
        action="ai_provider.deleted",
        resource_type="ai_provider",
        resource_id=provider.id,
    )
    await db.delete(provider)
    await db.commit()


@router.post("/{provider_id}/test")
async def test_provider(
    provider_id: UUID,
    context: CurrentContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    provider = await db.scalar(
        select(AIProvider).where(
            AIProvider.id == provider_id, AIProvider.tenant_id == context.tenant.id
        )
    )
    if not provider:
        raise HTTPException(status_code=404, detail="AI provider not found")
    provider.base_url = validate_base_url(provider.base_url or "")
    headers = {}
    if provider.api_key_encrypted:
        from app.secrets import decrypt_secret

        try:
            api_key = decrypt_secret(provider.api_key_encrypted)
        except InvalidToken as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "The saved API key was encrypted with a different ENCRYPTION_KEY. "
                    "Edit this provider, enter its API key again, and save it."
                ),
            ) from exc
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        async with httpx.AsyncClient(timeout=provider.timeout_seconds) as client:
            if provider.kind == "embedding":
                response = await client.post(
                    f"{provider.base_url}/embeddings",
                    headers=headers,
                    json={"model": provider.model, "input": ["Lumix embedding health check"]},
                )
                if response.is_success:
                    body = response.json()
                    if not body.get("data") or not body["data"][0].get("embedding"):
                        return {
                            "ok": False,
                            "message": "Endpoint responded but did not return an embedding",
                        }
            else:
                response = await client.get(f"{provider.base_url}/models", headers=headers)
                if response.is_success:
                    body = response.json()
                    available_models = [item.get("id") for item in body.get("data", [])]
                    if available_models and provider.model not in available_models:
                        return {
                            "ok": False,
                            "message": "Endpoint is reachable, but the configured model was not listed",
                        }
        if response.is_success:
            return {"ok": True, "message": "Provider endpoint and model are reachable"}
        return {"ok": False, "message": f"Provider returned HTTP {response.status_code}"}
    except (httpx.HTTPError, ValueError):
        return {"ok": False, "message": "Provider endpoint could not be reached"}
