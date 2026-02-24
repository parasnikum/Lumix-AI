import asyncio
from hashlib import sha256

import chromadb

from app.core.config import settings


def collection_name(tenant_id: str, knowledge_base_id: str) -> str:
    digest = sha256(f"{tenant_id}:{knowledge_base_id}".encode()).hexdigest()[:48]
    return f"l_{digest}"


async def delete_knowledge_base_collection(tenant_id: str, knowledge_base_id: str) -> None:
    client = chromadb.HttpClient(host=settings.chroma_host, port=settings.chroma_port)
    try:
        await asyncio.to_thread(
            client.delete_collection, collection_name(tenant_id, knowledge_base_id)
        )
    except chromadb.errors.NotFoundError:
        return


async def delete_document_vectors(tenant_id: str, knowledge_base_id: str, document_id: str) -> None:
    client = chromadb.HttpClient(host=settings.chroma_host, port=settings.chroma_port)
    try:
        collection = await asyncio.to_thread(
            client.get_collection, collection_name(tenant_id, knowledge_base_id)
        )
    except chromadb.errors.NotFoundError:
        return
    await asyncio.to_thread(collection.delete, where={"document_id": document_id})
