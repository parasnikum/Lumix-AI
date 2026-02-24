import asyncio
import csv
import io
import json
import re
from urllib.parse import quote, urlparse
from uuid import UUID

import chromadb
import pymupdf as fitz
from arq.connections import RedisSettings
from bs4 import BeautifulSoup
from cryptography.fernet import InvalidToken
from docx import Document as DocxDocument
from langchain_openai import OpenAIEmbeddings
from openpyxl import load_workbook
from pptx import Presentation
from sqlalchemy import select

from app.core.config import settings
from app.db import SessionLocal
from app.models import AIProvider, Document, DocumentStatus, KnowledgeBase
from app.secrets import decrypt_secret
from app.storage import _client
from app.vector_store import collection_name


def extract_pdf_pages(content: bytes) -> list[tuple[str, int | None]]:
    """Extract PDF text while preserving clickable external links as Markdown."""
    pages: list[tuple[str, int | None]] = []
    with fitz.open(stream=content, filetype="pdf") as pdf:
        for page_number, page in enumerate(pdf, start=1):
            links = []
            for link in page.get_links():
                uri = str(link.get("uri") or "").strip()
                if urlparse(uri).scheme.lower() not in {"http", "https", "mailto"}:
                    continue
                rect = fitz.Rect(link.get("from", (0, 0, 0, 0)))
                if not rect.is_empty:
                    links.append({"uri": uri, "rect": rect, "used": False})

            output_lines: list[str] = []
            page_data = page.get_text("dict", sort=True)
            for block in page_data.get("blocks", []):
                if block.get("type") != 0:
                    continue
                for line in block.get("lines", []):
                    pieces: list[str] = []
                    active_uri: str | None = None
                    active_text = ""

                    def flush_link() -> None:
                        nonlocal active_uri, active_text
                        if active_text:
                            safe_uri = quote(active_uri or "", safe=":/?#[]@!$&'()*+,;=%")
                            pieces.append(f"[{active_text.strip()}](<{safe_uri}>)")
                        active_uri = None
                        active_text = ""

                    for span in sorted(line.get("spans", []), key=lambda item: item["bbox"][0]):
                        value = str(span.get("text") or "")
                        if not value:
                            continue
                        span_rect = fitz.Rect(span["bbox"])
                        span_area = max(span_rect.get_area(), 0.01)
                        matched = None
                        for candidate in links:
                            intersection = span_rect & candidate["rect"]
                            if not intersection.is_empty and intersection.get_area() / span_area >= 0.35:
                                matched = candidate
                                break
                        if matched:
                            if active_uri != matched["uri"]:
                                flush_link()
                                active_uri = matched["uri"]
                            active_text += value
                            matched["used"] = True
                        else:
                            flush_link()
                            pieces.append(value)
                    flush_link()
                    line_text = "".join(pieces).strip()
                    if line_text:
                        output_lines.append(line_text)

            page_text = "\n".join(output_lines).strip()
            unplaced_links = []
            for index, link in enumerate(links, start=1):
                if link["used"]:
                    continue
                anchor_text = page.get_textbox(link["rect"]).strip()
                safe_uri = quote(link["uri"], safe=":/?#[]@!$&'()*+,;=%")
                label = anchor_text or f"Linked destination {index}"
                unplaced_links.append(f"- [{label}](<{safe_uri}>)")
            if unplaced_links:
                page_text += ("\n\n" if page_text else "") + "Links on this page:\n" + "\n".join(unplaced_links)
            pages.append((page_text, page_number))
    return pages


def extract_pages(filename: str, content: bytes) -> list[tuple[str, int | None]]:
    extension = filename.rsplit(".", 1)[-1].lower()
    if extension == "pdf":
        return extract_pdf_pages(content)
    if extension == "docx":
        doc = DocxDocument(io.BytesIO(content))
        return [("\n".join(p.text for p in doc.paragraphs), None)]
    if extension == "pptx":
        presentation = Presentation(io.BytesIO(content))
        return [
            (
                "\n".join(
                    shape.text for shape in slide.shapes if getattr(shape, "has_text_frame", False)
                ),
                index + 1,
            )
            for index, slide in enumerate(presentation.slides)
        ]
    if extension in {"html", "htm"}:
        soup = BeautifulSoup(content, "html.parser")
        for node in soup(["script", "style", "noscript"]):
            node.decompose()
        return [(soup.get_text(" ", strip=True), None)]
    if extension == "json":
        parsed = json.loads(content.decode("utf-8-sig"))
        return [(json.dumps(parsed, ensure_ascii=False, indent=2), None)]
    if extension in {"txt", "md"}:
        return [(content.decode("utf-8-sig"), None)]
    if extension == "csv":
        rows = csv.reader(io.StringIO(content.decode("utf-8-sig")))
        return [("\n".join(" | ".join(row) for row in rows), None)]
    if extension == "xlsx":
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        result = []
        for sheet in workbook.worksheets:
            lines = [
                " | ".join("" if value is None else str(value) for value in row)
                for row in sheet.iter_rows(values_only=True)
            ]
            result.append((f"Sheet: {sheet.title}\n" + "\n".join(lines), None))
        return result
    raise ValueError("Unsupported document format")


def split_text(text: str, size: int = 4000, overlap: int = 600) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    chunks, start = [], 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            boundary = text.rfind(" ", start + size // 2, end)
            if boundary > start:
                end = boundary
        chunks.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return [chunk for chunk in chunks if chunk]


async def process_document(ctx, document_id: str, tenant_id: str, knowledge_base_id: str):
    async with SessionLocal() as db:
        document = await db.scalar(
            select(Document).where(
                Document.id == UUID(document_id),
                Document.tenant_id == UUID(tenant_id),
                Document.knowledge_base_id == UUID(knowledge_base_id),
            )
        )
        if not document:
            return
        kb = await db.scalar(
            select(KnowledgeBase).where(
                KnowledgeBase.id == UUID(knowledge_base_id),
                KnowledgeBase.tenant_id == UUID(tenant_id),
            )
        )
        if not kb:
            return
        provider = None
        if kb.embedding_provider_id:
            provider = await db.scalar(
                select(AIProvider).where(
                    AIProvider.id == kb.embedding_provider_id,
                    AIProvider.tenant_id == UUID(tenant_id),
                    AIProvider.kind == "embedding",
                    AIProvider.is_active.is_(True),
                )
            )
            if not provider:
                document.status = DocumentStatus.failed
                document.error_message = "The configured embedding provider is unavailable"
                await db.commit()
                return
        embedding_config = None
        if provider:
            try:
                provider_api_key = (
                    decrypt_secret(provider.api_key_encrypted)
                    if provider.api_key_encrypted
                    else "local-provider"
                )
            except InvalidToken:
                document.status = DocumentStatus.failed
                document.error_message = (
                    "The embedding provider API key cannot be decrypted with the current "
                    "ENCRYPTION_KEY. Edit the provider, enter its API key again, and save it."
                )
                await db.commit()
                return
            embedding_config = {
                "model": provider.model,
                "base_url": provider.base_url,
                "api_key": provider_api_key,
                "timeout": provider.timeout_seconds,
            }
        embedding_model = kb.embedding_model
        expected_dimensions = kb.embedding_dimensions
        document.status = DocumentStatus.processing
        document.error_message = None
        await db.commit()
        try:
            raw = await asyncio.to_thread(
                lambda: (
                    _client()
                    .get_object(Bucket=settings.s3_bucket, Key=document.object_key)["Body"]
                    .read()
                )
            )
            pages = await asyncio.to_thread(extract_pages, document.filename, raw)
            chunks, metadata = [], []
            for text, page_number in pages:
                for part in split_text(text, size=kb.chunk_size * 4, overlap=kb.chunk_overlap * 4):
                    chunks.append(part)
                    metadata.append(
                        {
                            "tenant_id": tenant_id,
                            "knowledge_base_id": knowledge_base_id,
                            "document_id": document_id,
                            "source_name": document.filename,
                            "page_number": page_number or 0,
                            "embedding_model": embedding_model,
                        }
                    )
            if not chunks:
                raise ValueError("No readable text was found in this document")

            client = chromadb.HttpClient(host=settings.chroma_host, port=settings.chroma_port)
            vector_collection_name = collection_name(tenant_id, knowledge_base_id)
            collection = await asyncio.to_thread(
                client.get_or_create_collection,
                vector_collection_name,
                metadata={
                    "hnsw:space": "cosine",
                    "embedding_model": embedding_model,
                    "embedding_provider_id": str(kb.embedding_provider_id)
                    if kb.embedding_provider_id
                    else "default",
                },
            )
            collection_meta = collection.metadata or {}
            expected_provider_id = (
                str(kb.embedding_provider_id) if kb.embedding_provider_id else "default"
            )
            if (
                collection_meta.get("embedding_model") != embedding_model
                or collection_meta.get("embedding_provider_id") != expected_provider_id
            ):
                raise ValueError(
                    "Embedding configuration does not match this knowledge base's vector collection"
                )
            ids = [f"{document_id}:{index}" for index in range(len(chunks))]
            await asyncio.to_thread(collection.delete, where={"document_id": document_id})
            if embedding_config:
                embeddings = OpenAIEmbeddings(
                    model=embedding_config["model"],
                    base_url=embedding_config["base_url"],
                    api_key=embedding_config["api_key"],
                    request_timeout=embedding_config["timeout"],
                )
                vectors = await embeddings.aembed_documents(chunks)
                if expected_dimensions and len(vectors[0]) != expected_dimensions:
                    raise ValueError(
                        "Embedding dimensions changed. Create a new knowledge base or re-index it."
                    )
                kb.embedding_dimensions = len(vectors[0])
                await asyncio.to_thread(
                    collection.upsert,
                    ids=ids,
                    documents=chunks,
                    metadatas=metadata,
                    embeddings=vectors,
                )
            else:
                await asyncio.to_thread(
                    collection.upsert, ids=ids, documents=chunks, metadatas=metadata
                )
            document.status = DocumentStatus.ready
        except Exception as exc:
            document.status = DocumentStatus.failed
            document.error_message = str(exc)[:1000]
        await db.commit()


class WorkerSettings:
    functions = [process_document]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_jobs = 5
    job_timeout = 900
    max_tries = 3
