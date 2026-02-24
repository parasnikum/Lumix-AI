from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.dependencies import CurrentContext, require_roles
from app.models import Document, KnowledgeBase, TenantRole, UsageLog, User

router = APIRouter(prefix="/analytics", tags=["usage analytics"])
ANALYTICS_ROLES = (TenantRole.owner, TenantRole.admin)


@router.get("/overview")
async def usage_overview(
    days: int = Query(default=30, ge=7, le=90),
    context: CurrentContext = Depends(require_roles(*ANALYTICS_ROLES)),
    db: AsyncSession = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    totals = await db.execute(
        select(
            func.count(UsageLog.id).label("requests"),
            func.coalesce(func.sum(UsageLog.input_tokens), 0).label("input_tokens"),
            func.coalesce(func.sum(UsageLog.output_tokens), 0).label("output_tokens"),
        ).where(UsageLog.tenant_id == context.tenant.id, UsageLog.created_at >= since)
    )
    total = totals.one()
    daily_rows = await db.execute(
        select(
            func.date_trunc("day", UsageLog.created_at).label("day"),
            func.count(UsageLog.id).label("requests"),
            func.coalesce(func.sum(UsageLog.input_tokens + UsageLog.output_tokens), 0).label(
                "tokens"
            ),
        )
        .where(UsageLog.tenant_id == context.tenant.id, UsageLog.created_at >= since)
        .group_by(func.date_trunc("day", UsageLog.created_at))
        .order_by(func.date_trunc("day", UsageLog.created_at))
    )
    top_users = await db.execute(
        select(
            User.full_name,
            func.count(UsageLog.id).label("requests"),
            func.coalesce(func.sum(UsageLog.input_tokens + UsageLog.output_tokens), 0).label(
                "tokens"
            ),
        )
        .join(User, User.id == UsageLog.user_id)
        .where(UsageLog.tenant_id == context.tenant.id, UsageLog.created_at >= since)
        .group_by(User.id, User.full_name)
        .order_by(func.count(UsageLog.id).desc())
        .limit(5)
    )
    document_rows = await db.execute(
        select(Document.status, func.count(Document.id))
        .where(Document.tenant_id == context.tenant.id)
        .group_by(Document.status)
    )
    knowledge_base_rows = await db.execute(
        select(KnowledgeBase.name, func.count(Document.id).label("documents"))
        .outerjoin(
            Document,
            (Document.knowledge_base_id == KnowledgeBase.id)
            & (Document.tenant_id == context.tenant.id),
        )
        .where(KnowledgeBase.tenant_id == context.tenant.id, KnowledgeBase.is_active.is_(True))
        .group_by(KnowledgeBase.id, KnowledgeBase.name)
        .order_by(func.count(Document.id).desc())
        .limit(5)
    )
    return {
        "period_days": days,
        "totals": {
            "requests": total.requests,
            "input_tokens": total.input_tokens,
            "output_tokens": total.output_tokens,
        },
        "daily": [
            {"date": row.day.date().isoformat(), "requests": row.requests, "tokens": row.tokens}
            for row in daily_rows
        ],
        "top_users": [
            {"name": row.full_name, "requests": row.requests, "tokens": row.tokens}
            for row in top_users
        ],
        "document_status": [
            {"status": status.value, "count": count} for status, count in document_rows
        ],
        "knowledge_bases": [
            {"name": row.name, "documents": row.documents} for row in knowledge_base_rows
        ],
    }
