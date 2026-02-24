import re
from uuid import UUID, uuid4

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.knowledge_bases import accessible_kb
from app.audit_log import record_audit
from app.core.config import settings
from app.db import get_db
from app.dependencies import CurrentContext, get_current_context
from app.models import Document, DocumentStatus, DocumentVersion
from app.storage import delete_object, put_object, signed_download_url
from app.vector_store import delete_document_vectors, delete_knowledge_base_collection

router = APIRouter(tags=["documents"])
ALLOWED_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".html": "text/html",
    ".htm": "text/html",
    ".json": "application/json",
}


def safe_filename(value: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._")
    return name[:180] or "document"


@router.post("/knowledge-bases/{kb_id}/documents", status_code=status.HTTP_202_ACCEPTED)
async def upload_documents(
    kb_id: UUID,
    files: list[UploadFile] = File(default=[]),
    file: UploadFile | None = File(default=None),
    context: CurrentContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    await accessible_kb(kb_id, context, db, manage=True)
    uploads = ([file] if file else []) + files
    if not uploads:
        raise HTTPException(status_code=422, detail="Select at least one file")
    if len(uploads) > 20:
        raise HTTPException(status_code=413, detail="Upload up to 20 files at a time")

    documents, uploaded_keys = [], []
    total_size = 0
    try:
        for upload in uploads:
            filename = safe_filename(upload.filename or "")
            extension = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
            if extension not in ALLOWED_TYPES:
                raise HTTPException(status_code=415, detail=f"Unsupported format: {filename}")
            content = await upload.read(settings.max_upload_size_mb * 1024 * 1024 + 1)
            if not content:
                raise HTTPException(status_code=400, detail=f"{filename} is empty")
            if len(content) > settings.max_upload_size_mb * 1024 * 1024:
                raise HTTPException(
                    status_code=413,
                    detail=f"{filename} exceeds the {settings.max_upload_size_mb} MB per-file limit",
                )
            total_size += len(content)
            if total_size > settings.max_batch_upload_size_mb * 1024 * 1024:
                raise HTTPException(
                    status_code=413,
                    detail=f"Combined upload exceeds the {settings.max_batch_upload_size_mb} MB batch limit",
                )
            if extension == ".pdf" and not content.startswith(b"%PDF"):
                raise HTTPException(status_code=415, detail=f"{filename} is not a valid PDF")
            if extension in {".docx", ".xlsx", ".pptx"} and not content.startswith(b"PK"):
                raise HTTPException(
                    status_code=415, detail=f"{filename} does not match its selected format"
                )
            document_id = uuid4()
            object_key = f"tenants/{context.tenant.id}/knowledge-bases/{kb_id}/documents/{document_id}/{filename}"
            await put_object(object_key, content, ALLOWED_TYPES[extension])
            uploaded_keys.append(object_key)
            documents.append(
                Document(
                    id=document_id,
                    tenant_id=context.tenant.id,
                    knowledge_base_id=kb_id,
                    uploaded_by=context.user.id,
                    filename=filename,
                    content_type=ALLOWED_TYPES[extension],
                    size_bytes=len(content),
                    object_key=object_key,
                    status=DocumentStatus.queued,
                )
            )
        db.add_all(documents)
        await db.flush()
        db.add_all(
            [
                DocumentVersion(
                    tenant_id=document.tenant_id,
                    document_id=document.id,
                    version_number=1,
                    filename=document.filename,
                    content_type=document.content_type,
                    size_bytes=document.size_bytes,
                    object_key=document.object_key,
                    uploaded_by=document.uploaded_by,
                )
                for document in documents
            ]
        )
        for document in documents:
            record_audit(
                db,
                tenant_id=context.tenant.id,
                actor_user_id=context.user.id,
                action="document.uploaded",
                resource_type="document",
                resource_id=document.id,
            )
        await db.commit()
    except Exception:
        await db.rollback()
        for key in uploaded_keys:
            await delete_object(key)
        raise

    pool = None
    try:
        pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        for document in documents:
            try:
                await pool.enqueue_job(
                    "process_document", str(document.id), str(context.tenant.id), str(kb_id)
                )
            except Exception:
                document.status = DocumentStatus.failed
                document.error_message = (
                    "Processing queue is unavailable. Retry processing when the worker is online."
                )
        await db.commit()
    except Exception:
        for document in documents:
            document.status = DocumentStatus.failed
            document.error_message = (
                "Processing queue is unavailable. Retry processing when the worker is online."
            )
        await db.commit()
    finally:
        if pool:
            await pool.aclose()
    return {
        "documents": [
            {"id": str(d.id), "filename": d.filename, "status": d.status.value} for d in documents
        ]
    }


@router.get("/knowledge-bases/{kb_id}/documents")
async def list_documents(
    kb_id: UUID,
    context: CurrentContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    await accessible_kb(kb_id, context, db)
    rows = await db.scalars(
        select(Document)
        .where(Document.tenant_id == context.tenant.id, Document.knowledge_base_id == kb_id)
        .order_by(Document.created_at.desc())
    )
    return [
        {
            "id": str(d.id),
            "filename": d.filename,
            "content_type": d.content_type,
            "size_bytes": d.size_bytes,
            "version_number": d.version_number,
            "status": d.status.value,
            "error_message": d.error_message,
            "created_at": d.created_at,
        }
        for d in rows
    ]


@router.get("/documents/{document_id}/versions")
async def list_document_versions(
    document_id: UUID,
    context: CurrentContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    document = await db.scalar(
        select(Document).where(Document.id == document_id, Document.tenant_id == context.tenant.id)
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    await accessible_kb(document.knowledge_base_id, context, db)
    versions = await db.scalars(
        select(DocumentVersion)
        .where(
            DocumentVersion.tenant_id == context.tenant.id,
            DocumentVersion.document_id == document.id,
        )
        .order_by(DocumentVersion.version_number.desc())
    )
    return [
        {
            "version_number": item.version_number,
            "filename": item.filename,
            "size_bytes": item.size_bytes,
            "created_at": item.created_at,
            "uploaded_by": str(item.uploaded_by),
        }
        for item in versions
    ]


@router.get("/documents/{document_id}/versions/{version_number}/download")
async def download_document_version(
    document_id: UUID,
    version_number: int,
    context: CurrentContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    document = await db.scalar(
        select(Document).where(Document.id == document_id, Document.tenant_id == context.tenant.id)
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    await accessible_kb(document.knowledge_base_id, context, db)
    version = await db.scalar(
        select(DocumentVersion).where(
            DocumentVersion.tenant_id == context.tenant.id,
            DocumentVersion.document_id == document.id,
            DocumentVersion.version_number == version_number,
        )
    )
    if not version:
        raise HTTPException(status_code=404, detail="Document version not found")
    return {
        "url": await signed_download_url(version.object_key, version.filename),
        "expires_in": 300,
    }


@router.post("/documents/{document_id}/versions", status_code=status.HTTP_202_ACCEPTED)
async def upload_document_version(
    document_id: UUID,
    file: UploadFile = File(...),
    context: CurrentContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    document = await db.scalar(
        select(Document).where(Document.id == document_id, Document.tenant_id == context.tenant.id)
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    await accessible_kb(document.knowledge_base_id, context, db, manage=True)
    if document.status in {DocumentStatus.queued, DocumentStatus.processing}:
        raise HTTPException(
            status_code=409,
            detail="Wait for the current indexing job to finish before uploading another version",
        )
    filename = safe_filename(file.filename or "")
    extension = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail=f"Unsupported format: {filename}")
    content = await file.read(settings.max_upload_size_mb * 1024 * 1024 + 1)
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")
    if len(content) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(
            status_code=413, detail=f"Maximum file size is {settings.max_upload_size_mb} MB"
        )
    if extension == ".pdf" and not content.startswith(b"%PDF"):
        raise HTTPException(status_code=415, detail="File content does not match PDF format")
    if extension in {".docx", ".xlsx", ".pptx"} and not content.startswith(b"PK"):
        raise HTTPException(
            status_code=415, detail="File content does not match the selected document format"
        )

    version_number = document.version_number + 1
    object_key = (
        f"tenants/{context.tenant.id}/knowledge-bases/{document.knowledge_base_id}/"
        f"documents/{document.id}/versions/{version_number}/{filename}"
    )
    await put_object(object_key, content, ALLOWED_TYPES[extension])
    version = DocumentVersion(
        tenant_id=context.tenant.id,
        document_id=document.id,
        version_number=version_number,
        filename=filename,
        content_type=ALLOWED_TYPES[extension],
        size_bytes=len(content),
        object_key=object_key,
        uploaded_by=context.user.id,
    )
    db.add(version)
    document.version_number = version_number
    document.filename = filename
    document.content_type = ALLOWED_TYPES[extension]
    document.size_bytes = len(content)
    document.object_key = object_key
    document.status = DocumentStatus.queued
    document.error_message = None
    record_audit(
        db,
        tenant_id=context.tenant.id,
        actor_user_id=context.user.id,
        action="document.version_uploaded",
        resource_type="document",
        resource_id=document.id,
    )
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        await delete_object(object_key)
        raise

    pool = None
    try:
        pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await pool.enqueue_job(
            "process_document",
            str(document.id),
            str(context.tenant.id),
            str(document.knowledge_base_id),
        )
    except Exception:
        document.status = DocumentStatus.failed
        document.error_message = (
            "Processing queue is unavailable. Retry processing when the worker is online."
        )
        await db.commit()
        raise HTTPException(
            status_code=503, detail="New version saved but could not be queued for indexing"
        )
    finally:
        if pool:
            await pool.aclose()
    return {
        "id": str(document.id),
        "version_number": version_number,
        "status": document.status.value,
    }


@router.get("/documents/{document_id}/status")
async def document_status(
    document_id: UUID,
    context: CurrentContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    document = await db.scalar(
        select(Document).where(Document.id == document_id, Document.tenant_id == context.tenant.id)
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    await accessible_kb(document.knowledge_base_id, context, db)
    return {
        "id": str(document.id),
        "status": document.status.value,
        "error_message": document.error_message,
    }


@router.get("/documents/{document_id}/download")
async def download_document(
    document_id: UUID,
    context: CurrentContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    document = await db.scalar(
        select(Document).where(Document.id == document_id, Document.tenant_id == context.tenant.id)
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    await accessible_kb(document.knowledge_base_id, context, db)
    return {
        "url": await signed_download_url(document.object_key, document.filename),
        "expires_in": 300,
    }


@router.post("/documents/{document_id}/reprocess", status_code=status.HTTP_202_ACCEPTED)
async def reprocess_document(
    document_id: UUID,
    context: CurrentContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    document = await db.scalar(
        select(Document).where(Document.id == document_id, Document.tenant_id == context.tenant.id)
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    await accessible_kb(document.knowledge_base_id, context, db, manage=True)
    if document.status in {DocumentStatus.queued, DocumentStatus.processing}:
        raise HTTPException(status_code=409, detail="Document is already queued or processing")
    document.status, document.error_message = DocumentStatus.queued, None
    await db.commit()
    pool = None
    try:
        pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await pool.enqueue_job(
            "process_document",
            str(document.id),
            str(context.tenant.id),
            str(document.knowledge_base_id),
        )
    except Exception:
        document.status = DocumentStatus.failed
        document.error_message = "Processing queue is unavailable. Retry when the worker is online."
        await db.commit()
        raise HTTPException(status_code=503, detail="Document could not be queued for reprocessing")
    finally:
        if pool:
            await pool.aclose()
    return {"id": str(document.id), "status": document.status.value}


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: UUID,
    context: CurrentContext = Depends(get_current_context),
    db: AsyncSession = Depends(get_db),
):
    document = await db.scalar(
        select(Document).where(Document.id == document_id, Document.tenant_id == context.tenant.id)
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    await accessible_kb(document.knowledge_base_id, context, db, manage=True)
    if document.status in {DocumentStatus.queued, DocumentStatus.processing}:
        raise HTTPException(
            status_code=409, detail="Wait for document indexing to finish before deleting it"
        )
    remaining_documents = await db.scalar(
        select(func.count(Document.id)).where(
            Document.tenant_id == context.tenant.id,
            Document.knowledge_base_id == document.knowledge_base_id,
            Document.id != document.id,
        )
    )
    if remaining_documents:
        await delete_document_vectors(
            str(context.tenant.id), str(document.knowledge_base_id), str(document.id)
        )
    else:
        await delete_knowledge_base_collection(
            str(context.tenant.id), str(document.knowledge_base_id)
        )
    versions = await db.scalars(
        select(DocumentVersion).where(
            DocumentVersion.tenant_id == context.tenant.id,
            DocumentVersion.document_id == document.id,
        )
    )
    object_keys = {document.object_key, *(version.object_key for version in versions)}
    for object_key in object_keys:
        await delete_object(object_key)
    record_audit(
        db,
        tenant_id=context.tenant.id,
        actor_user_id=context.user.id,
        action="document.deleted",
        resource_type="document",
        resource_id=document.id,
    )
    await db.delete(document)
    await db.commit()
    return None
