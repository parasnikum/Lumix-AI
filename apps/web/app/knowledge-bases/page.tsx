"use client";

import Link from "next/link";
import AppSidebar from "../components/AppSidebar";
import { FormEvent, useEffect, useState } from "react";
import { api, KnowledgeBase, Tenant } from "../lib/api";

export default function KnowledgeBasesPage() {
  const [items, setItems] = useState<KnowledgeBase[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"restricted" | "tenant">(
    "restricted",
  );
  const [embeddingProviders, setEmbeddingProviders] = useState<
    { id: string; name: string }[]
  >([]);
  const [embeddingProviderId, setEmbeddingProviderId] = useState("");
  const [chunkSize, setChunkSize] = useState(1000);
  const [chunkOverlap, setChunkOverlap] = useState(150);
  const [topK, setTopK] = useState(5);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const [org, data, providers] = await Promise.all([
      api<Tenant>("/tenants/current"),
      api<KnowledgeBase[]>("/knowledge-bases"),
      api<{ id: string; name: string; kind: string; is_active: boolean }[]>(
        "/ai/providers",
      ),
    ]);
    setTenant(org);
    setItems(data);
    setEmbeddingProviders(
      providers.filter((item) => item.kind === "embedding" && item.is_active),
    );
  }
  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await api("/knowledge-bases", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: description || null,
          visibility,
          embedding_provider_id: embeddingProviderId || null,
          chunk_size: chunkSize,
          chunk_overlap: chunkOverlap,
          retrieval_top_k: topK,
        }),
      });
      setName("");
      setDescription("");
      setShowForm(false);
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to create knowledge base",
      );
    }
  }

  return (
    <main className="app-shell">
      <AppSidebar active="knowledge-bases" tenantName={tenant?.name} />
      <section className="app-main">
        <header className="app-topbar">
          <span>
            Workspace <i>/</i> Knowledge bases
          </span>
          <span className="live-label">
            <b /> Connected workspace
          </span>
        </header>
        <div className="app-content">
          <div className="list-page-heading">
            <div>
              <div className="eyebrow">KNOWLEDGE MANAGEMENT</div>
              <h1>Knowledge bases</h1>
              <p>
                Organize source documents into secure, searchable collections.
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => setShowForm(!showForm)}
            >
              {showForm ? "Close" : "New knowledge base"} <span>＋</span>
            </button>
          </div>
          {error && <div className="notice-error">{error}</div>}
          {showForm && (
            <form className="create-panel" onSubmit={create}>
              <h2>Create a knowledge base</h2>
              <label>
                Name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  minLength={2}
                  maxLength={160}
                  required
                  placeholder="e.g. Product documentation"
                />
              </label>
              <label>
                Description <span className="optional-label">Optional</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="What information belongs here?"
                />
              </label>
              <label>
                Access
                <select
                  value={visibility}
                  onChange={(e) =>
                    setVisibility(e.target.value as "restricted" | "tenant")
                  }
                >
                  <option value="restricted">
                    Restricted — only assigned members
                  </option>
                  <option value="tenant">Workspace — all members</option>
                </select>
              </label>
              <label>
                Embedding provider
                <select
                  value={embeddingProviderId}
                  onChange={(e) => setEmbeddingProviderId(e.target.value)}
                >
                  <option value="">Chroma default · all-MiniLM-L6-v2</option>
                  {embeddingProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="profile-form-grid">
                <label>
                  Chunk size
                  <input
                    type="number"
                    min={200}
                    max={4000}
                    value={chunkSize}
                    onChange={(e) => setChunkSize(Number(e.target.value))}
                  />
                </label>
                <label>
                  Chunk overlap
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={chunkOverlap}
                    onChange={(e) => setChunkOverlap(Number(e.target.value))}
                  />
                </label>
                <label>
                  Retrieval top K
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={topK}
                    onChange={(e) => setTopK(Number(e.target.value))}
                  />
                </label>
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
                <button className="primary-button">
                  Create knowledge base <span>→</span>
                </button>
              </div>
            </form>
          )}
          {loading ? (
            <div className="empty-panel">Loading knowledge bases…</div>
          ) : items.length ? (
            <div className="kb-list">
              {items.map((kb) => (
                <Link
                  href={`/knowledge-bases/${kb.id}`}
                  className="kb-list-row"
                  key={kb.id}
                >
                  <div className="kb-card-icon">▤</div>
                  <div className="kb-list-copy">
                    <strong>{kb.name}</strong>
                    <p>{kb.description || "No description"}</p>
                  </div>
                  <span className="kb-visibility">
                    {kb.visibility === "tenant"
                      ? "Workspace access"
                      : "Restricted"}
                  </span>
                  <span className="kb-open">Open →</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-panel">
              <div className="empty-icon">▤</div>
              <h3>No knowledge bases yet</h3>
              <p>
                Create your first collection to start organizing your documents.
              </p>
              <button
                className="secondary-button"
                onClick={() => setShowForm(true)}
              >
                Create your first knowledge base
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
