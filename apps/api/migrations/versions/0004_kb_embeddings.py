"""Persist embedding configuration on each knowledge base."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004_kb_embeddings"
down_revision = "0003_ai_chat"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "knowledge_bases",
        sa.Column("embedding_provider_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "knowledge_bases",
        sa.Column(
            "embedding_model", sa.String(160), nullable=False, server_default="all-MiniLM-L6-v2"
        ),
    )
    op.add_column("knowledge_bases", sa.Column("embedding_dimensions", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_knowledge_bases_embedding_provider",
        "knowledge_bases",
        "ai_providers",
        ["embedding_provider_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_knowledge_bases_embedding_provider", "knowledge_bases", type_="foreignkey"
    )
    op.drop_column("knowledge_bases", "embedding_dimensions")
    op.drop_column("knowledge_bases", "embedding_model")
    op.drop_column("knowledge_bases", "embedding_provider_id")
