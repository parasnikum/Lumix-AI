"""Enforce one personal profile per tenant and store default knowledge bases."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0006_profile_preferences"
down_revision = "0005_invitations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_ai_profile_tenant_user", "ai_profiles", ["tenant_id", "user_id"]
    )
    op.add_column(
        "ai_profiles",
        sa.Column(
            "default_knowledge_base_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "ai_profiles",
        sa.Column("memory_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("ai_profiles", "memory_enabled")
    op.drop_column("ai_profiles", "default_knowledge_base_ids")
    op.drop_constraint("uq_ai_profile_tenant_user", "ai_profiles", type_="unique")
