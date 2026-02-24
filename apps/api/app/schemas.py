from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=10, max_length=128)
    organization_name: str = Field(min_length=2, max_length=160)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: EmailStr
    full_name: str
    is_super_admin: bool


class TenantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    slug: str
    created_at: datetime


class AuthResponse(BaseModel):
    user: UserOut
    tenant: TenantOut


class KnowledgeBaseCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    visibility: Literal["tenant", "restricted"] = "restricted"
    embedding_provider_id: UUID | None = None
    chunk_size: int = Field(default=1000, ge=200, le=4000)
    chunk_overlap: int = Field(default=150, ge=0, le=1000)
    retrieval_top_k: int = Field(default=5, ge=1, le=20)

    @model_validator(mode="after")
    def validate_chunk_overlap(self):
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("Chunk overlap must be smaller than chunk size")
        return self


class KnowledgeBaseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    visibility: Literal["tenant", "restricted"] | None = None
    embedding_provider_id: UUID | None = None
    chunk_size: int | None = Field(default=None, ge=200, le=4000)
    chunk_overlap: int | None = Field(default=None, ge=0, le=1000)
    retrieval_top_k: int | None = Field(default=None, ge=1, le=20)


class KnowledgeBaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    description: str | None
    visibility: str
    embedding_provider_id: UUID | None
    embedding_model: str
    embedding_dimensions: int | None
    chunk_size: int
    chunk_overlap: int
    retrieval_top_k: int
    created_at: datetime


class KnowledgeBaseUserPermission(BaseModel):
    user_id: UUID
    can_manage: bool = False


class AIProviderCreate(BaseModel):
    kind: Literal["llm", "embedding"]
    name: str = Field(min_length=2, max_length=120)
    base_url: str = Field(min_length=8, max_length=500)
    model: str = Field(min_length=1, max_length=160)
    api_key: str | None = Field(default=None, max_length=2000)
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_tokens: int = Field(default=2048, ge=1, le=128000)
    timeout_seconds: int = Field(default=60, ge=5, le=300)


class AIProviderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    base_url: str | None = Field(default=None, min_length=8, max_length=500)
    model: str | None = Field(default=None, min_length=1, max_length=160)
    api_key: str | None = Field(default=None, max_length=2000)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=128000)
    timeout_seconds: int | None = Field(default=None, ge=5, le=300)
    is_active: bool | None = None


class AIProfileUpdate(BaseModel):
    assistant_name: str = Field(default="Lumix", min_length=1, max_length=100)
    personality: str = Field(default="Helpful assistant", max_length=120)
    language: str = Field(default="English", max_length=60)
    tone: Literal["professional", "friendly", "casual"] = "professional"
    answer_length: Literal["short", "medium", "detailed"] = "medium"
    technical_level: Literal["beginner", "intermediate", "expert"] = "intermediate"
    preferred_format: Literal["paragraph", "bullets", "tables"] = "paragraph"
    custom_instructions: str = Field(default="", max_length=4000)
    preferred_provider_id: UUID | None = None
    default_knowledge_base_ids: list[UUID] = Field(default_factory=list, max_length=20)
    memory_enabled: bool = True


class ConversationCreate(BaseModel):
    title: str = Field(default="New conversation", min_length=1, max_length=200)
    knowledge_base_ids: list[UUID] = Field(min_length=1, max_length=20)


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    is_archived: bool | None = None


class ChatMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=12000)
    provider_id: UUID | None = None

    @field_validator("content")
    @classmethod
    def normalize_content(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Message content cannot be empty")
        return normalized


class InvitationCreate(BaseModel):
    email: EmailStr
    role: Literal["admin", "knowledge_manager", "member", "viewer"] = "member"


class InvitationAccept(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=10, max_length=128)


class MemberUpdate(BaseModel):
    role: Literal["admin", "knowledge_manager", "member", "viewer"] | None = None
    is_active: bool | None = None
