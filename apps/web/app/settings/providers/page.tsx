"use client";

import AppSidebar from "../../components/AppSidebar";
import { FormEvent, useEffect, useState } from "react";
import { api, Tenant } from "../../lib/api";

type Provider = {
  id: string;
  kind: "llm" | "embedding";
  name: string;
  base_url: string;
  model: string;
  api_key_configured: boolean;
  temperature: number;
  max_tokens: number;
  timeout_seconds: number;
  is_active: boolean;
};
export default function ProvidersPage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [kind, setKind] = useState<"llm" | "embedding">("llm");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editingProviderHasKey, setEditingProviderHasKey] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  async function load() {
    const [org, list] = await Promise.all([
      api<Tenant>("/tenants/current"),
      api<Provider[]>("/ai/providers"),
    ]);
    setTenant(org);
    setProviders(list);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  function startEdit(item: Provider) {
    setEditingProviderId(item.id);
    setEditingProviderHasKey(item.api_key_configured);
    setKind(item.kind);
    setName(item.name);
    setBaseUrl(item.base_url);
    setModel(item.model);
    setApiKey("");
    setError("");
    setMessage("");
  }

  function cancelEdit() {
    setEditingProviderId(null);
    setEditingProviderHasKey(false);
    setName("");
    setModel("");
    setApiKey("");
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const editing = Boolean(editingProviderId);
      await api(editing ? `/ai/providers/${editingProviderId}` : "/ai/providers", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          ...(editing ? {} : { kind }),
          name,
          base_url: baseUrl,
          model,
          ...(apiKey ? { api_key: apiKey } : {}),
        }),
      });
      cancelEdit();
      await load();
      setMessage(
        editing
          ? "Provider updated. Its new credentials are encrypted and saved."
          : "Provider saved. Run a connection test before using it.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save provider");
    } finally {
      setLoading(false);
    }
  }
  async function test(id: string) {
    setMessage("");
    setError("");
    try {
      const result = await api<{ ok: boolean; message: string }>(
        `/ai/providers/${id}/test`,
        { method: "POST" },
      );
      result.ok ? setMessage(result.message) : setError(result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Provider test failed");
    }
  }
  async function remove(item: Provider) {
    const confirmed = window.confirm(
      `Delete the provider "${item.name}"? This action cannot be undone.`,
    );
    if (!confirmed) return;
    setError("");
    setMessage("");
    try {
      await api(`/ai/providers/${item.id}`, { method: "DELETE" });
      if (editingProviderId === item.id) cancelEdit();
      await load();
      setMessage(`Provider "${item.name}" deleted.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete provider");
    }
  }

  async function toggle(item: Provider) {
    try {
      await api(`/ai/providers/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !item.is_active }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update provider");
    }
  }
  return (
    <main className="app-shell">
      <AppSidebar active="providers" tenantName={tenant?.name} />
      <section className="app-main">
        <header className="app-topbar">
          <span>
            Configuration <i>/</i> AI providers
          </span>
          <span className="live-label">
            <b /> Workspace settings
          </span>
        </header>
        <div className="app-content">
          <div className="list-page-heading">
            <div>
              <div className="eyebrow">MODEL CONFIGURATION</div>
              <h1>AI providers</h1>
              <p>
                Connect language and embedding models independently. Credentials
                are encrypted before storage.
              </p>
            </div>
          </div>
          {error && <div className="notice-error">{error}</div>}
          {message && <div className="notice-success">{message}</div>}
          <div className="settings-columns">
            <form className="create-panel" onSubmit={create}>
              <h2>{editingProviderId ? "Edit provider" : "Add a provider"}</h2>
              {!editingProviderId && (
                <label>
                  Provider type
                  <select
                    value={kind}
                    onChange={(e) =>
                      setKind(e.target.value as "llm" | "embedding")
                    }
                  >
                    <option value="llm">Language model (chat)</option>
                    <option value="embedding">Embedding model (search)</option>
                  </select>
                </label>
              )}
              <label>
                Display name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. Local Ollama"
                />
              </label>
              <label>
                OpenAI-compatible base URL
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  required
                  placeholder="https://api.provider.com/v1"
                />
              </label>
              <label>
                Model identifier
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  required
                  placeholder={
                    kind === "llm" ? "gpt-4o-mini" : "text-embedding-3-small"
                  }
                />
              </label>
              <label>
                API key{" "}
                <span className="optional-label">
                  {editingProviderId && editingProviderHasKey
                    ? "Required to replace the saved key"
                    : "Optional for local endpoints"}
                </span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="new-password"
                  placeholder={
                    editingProviderId && editingProviderHasKey
                      ? "Re-enter provider API key"
                      : "Paste provider API key"
                  }
                  required={Boolean(editingProviderId && editingProviderHasKey)}
                />
              </label>
              <div className="form-actions">
                <button className="primary-button" disabled={loading}>
                  {loading
                    ? "Saving…"
                    : editingProviderId
                      ? "Update provider"
                      : "Save provider"}{" "}
                  <span>→</span>
                </button>
                {editingProviderId && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={cancelEdit}
                    disabled={loading}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
            <section className="provider-list">
              <div className="content-heading">
                <div>
                  <h2>Connected providers</h2>
                  <p>{providers.length} configured</p>
                </div>
              </div>
              {providers.length ? (
                <div className="provider-rows">
                  {providers.map((item) => (
                    <article className="provider-row" key={item.id}>
                      <div className="provider-row-main">
                        <div className="provider-row-title">
                          <strong>{item.name}</strong>
                          <span className="provider-type">
                            {item.kind === "llm" ? "CHAT" : "EMBEDDING"}
                          </span>
                          <span className={item.is_active ? "provider-active" : "provider-inactive"}>
                            {item.is_active ? "Active" : "Inactive"}
                          </span>
                        </div>
                        <span className="provider-row-model">{item.model}</span>
                        <span className="provider-row-url" title={item.base_url}>{item.base_url}</span>
                      </div>
                      <div className="provider-row-meta">
                        <span className="credential-note">
                          {item.api_key_configured ? "Key saved" : "No key"}
                        </span>
                        <div className="provider-row-actions">
                          <button type="button" className="secondary-button" onClick={() => test(item.id)}>
                            Test
                          </button>
                          <button type="button" className="secondary-button" onClick={() => toggle(item)}>
                            {item.is_active ? "Disable" : "Enable"}
                          </button>
                          <button type="button" className="secondary-button" onClick={() => startEdit(item)}>
                            Edit
                          </button>
                          <button type="button" className="provider-delete-button" onClick={() => remove(item)}>
                            Delete
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-panel">
                  <div className="empty-icon">✳</div>
                  <h3>No providers connected</h3>
                  <p>
                    Add an LLM provider to enable chat. Add an embedding
                    provider to customize semantic search.
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
