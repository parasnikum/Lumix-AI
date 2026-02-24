from uuid import uuid4

import jwt
import pytest
from app.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    decode_token_claims,
    hash_password,
    verify_password,
)


def test_password_hashing():
    hashed = hash_password("correct horse battery staple")
    assert hashed != "correct horse battery staple"
    assert verify_password("correct horse battery staple", hashed)
    assert not verify_password("wrong password", hashed)


def test_access_token_contains_tenant_and_session_context():
    user_id, tenant_id, session_id = uuid4(), uuid4(), uuid4()
    token = create_access_token(user_id, tenant_id, session_id)
    claims = decode_token_claims(token)
    assert claims["sub"] == str(user_id)
    assert claims["tenant_id"] == str(tenant_id)
    assert claims["sid"] == str(session_id)
    assert decode_token(token) == user_id


def test_refresh_token_type_and_identifier_are_enforced():
    token = create_refresh_token(uuid4(), uuid4(), uuid4(), str(uuid4()))
    assert decode_token_claims(token, "refresh")["type"] == "refresh"
    with pytest.raises(jwt.InvalidTokenError):
        decode_token_claims(token, "access")
