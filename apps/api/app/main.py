import asyncio
from contextlib import asynccontextmanager

import chromadb
from fastapi import FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis
from sqlalchemy import text

from app.api.v1.router import api_router
from app.core.config import settings
from app.db import engine
from app.storage import _client, _ensure_bucket


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.is_production:
        secret_key = settings.secret_key.get_secret_value()
        encryption_key = settings.encryption_key.get_secret_value()
        if (
            secret_key.lower().startswith("replace")
            or encryption_key.lower().startswith("replace")
            or len(secret_key) < 32
            or len(encryption_key) < 32
            or secret_key == encryption_key
        ):
            raise RuntimeError(
                "Production SECRET_KEY and ENCRYPTION_KEY must be separate, strong values"
            )
    yield
    await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="0.3.0",
    description="Multi-tenant AI knowledge platform API.",
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/health", tags=["system"])
@app.get("/health/live", tags=["system"])
async def health_live():
    return {"status": "ok", "service": "lumix-api"}


@app.get("/health/ready", tags=["system"])
async def health_ready(response: Response):
    async def check_database():
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
        return True

    async def check_redis():
        client = Redis.from_url(settings.redis_url)
        try:
            return bool(await client.ping())
        finally:
            await client.aclose()

    async def check_chroma():
        client = chromadb.HttpClient(host=settings.chroma_host, port=settings.chroma_port)
        await asyncio.to_thread(client.heartbeat)
        return True

    async def check_storage():
        await asyncio.to_thread(_ensure_bucket, _client())
        return True

    names = ("postgres", "redis", "chroma", "object_storage")
    checks = (check_database, check_redis, check_chroma, check_storage)
    results = await asyncio.gather(*(check() for check in checks), return_exceptions=True)
    dependencies = {
        name: "ok" if result is True else "unavailable" for name, result in zip(names, results)
    }
    ready = all(value == "ok" for value in dependencies.values())
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "ready" if ready else "degraded", "dependencies": dependencies}


app.include_router(api_router, prefix=settings.api_v1_prefix)
