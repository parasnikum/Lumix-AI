from app.secrets import decrypt_secret, encrypt_secret


def test_provider_secret_encryption_round_trip():
    secret = "sk-test-do-not-log-this"
    encrypted = encrypt_secret(secret)
    assert encrypted != secret
    assert decrypt_secret(encrypted) == secret
