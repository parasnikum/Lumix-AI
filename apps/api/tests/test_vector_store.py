from app.vector_store import collection_name


def test_vector_collection_name_is_valid_and_scoped():
    tenant_id = "2f41a53c-43e7-4c3e-8e7c-a0a3c1a9dabc"
    knowledge_base_id = "3b2a98e1-5e2d-44f2-b8c1-1c21e4e4dabc"
    name = collection_name(tenant_id, knowledge_base_id)
    assert len(name) <= 63
    assert name.startswith("l_")
    assert name == collection_name(tenant_id, knowledge_base_id)
    assert name != collection_name(tenant_id, "another-kb")
