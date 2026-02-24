import pytest
from app.api.v1.providers import validate_base_url
from fastapi import HTTPException


def test_provider_urls_require_https_for_remote_hosts():
    assert validate_base_url("https://api.example.com/v1/") == "https://api.example.com/v1"
    assert validate_base_url("http://localhost:11434/v1") == "http://localhost:11434/v1"
    with pytest.raises(HTTPException):
        validate_base_url("http://api.example.com/v1")


def test_provider_url_rejects_non_http_schemes():
    with pytest.raises(HTTPException):
        validate_base_url("file:///etc/passwd")
