from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Lumix API"
    app_env: str = "development"
    api_v1_prefix: str = "/api/v1"
    secret_key: SecretStr = Field(default=SecretStr("replace-this-secret-in-production"))
    encryption_key: SecretStr = Field(
        default=SecretStr("replace-this-encryption-key-in-production")
    )
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 14
    cors_origins: list[str] = ["http://localhost:3000"]
    database_url: str = "postgresql+asyncpg://lumix:lumix_dev_password@localhost:5644/lumix"
    db_pool_size: int = 10
    db_max_overflow: int = 10
    db_pool_timeout_seconds: int = 30
    db_pool_recycle_seconds: int = 1800
    redis_url: str = "redis://127.0.0.1:6380/0"
    chroma_url: str = "http://localhost:8001"
    s3_endpoint_url: str = "http://localhost:9000"
    s3_bucket: str = "lumix-documents"
    s3_access_key: str = "minioadmin"
    s3_secret_key: SecretStr = SecretStr("minioadmin")
    s3_region: str = "us-east-1"
    max_upload_size_mb: int = 25
    max_batch_upload_size_mb: int = 100
    model_config = SettingsConfigDict(
        env_file=next(
            (parent / ".env" for parent in Path(__file__).resolve().parents if (parent / ".env").is_file()),
            Path.cwd() / ".env",
        ),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def chroma_host(self) -> str:
        return urlparse(self.chroma_url).hostname or "localhost"

    @property
    def chroma_port(self) -> int:
        return urlparse(self.chroma_url).port or 8000


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
