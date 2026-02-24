from fastapi import APIRouter

from app.api.v1 import (
    analytics,
    auth,
    chats,
    documents,
    knowledge_bases,
    platform,
    profiles,
    providers,
    tenants,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(tenants.router)
api_router.include_router(knowledge_bases.router)
api_router.include_router(documents.router)
api_router.include_router(providers.router)
api_router.include_router(profiles.router)
api_router.include_router(chats.router)
api_router.include_router(platform.router)
api_router.include_router(analytics.router)


@api_router.get("/status", tags=["system"])
async def api_status() -> dict[str, str]:
    return {"service": "lumix-api", "status": "ready"}
