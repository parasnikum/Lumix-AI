"use client";

import AppSidebar from "../../components/AppSidebar";
import { FormEvent, useEffect, useState } from "react";
import { api, KnowledgeBase, Tenant } from "../../lib/api";

type Profile = {
  assistant_name: string;
  personality: string;
  language: string;
  tone: string;
  answer_length: string;
  technical_level: string;
  preferred_format: string;
  custom_instructions: string;
  preferred_provider_id: string | null;
  default_knowledge_base_ids: string[];
  memory_enabled: boolean;
};
type Provider = { id: string; name: string; kind: string; is_active: boolean };

const defaults: Profile = {
  assistant_name: "Lumix",
  personality: "Helpful assistant",
  language: "English",
  tone: "professional",
  answer_length: "medium",
  technical_level: "intermediate",
  preferred_format: "paragraph",
  custom_instructions: "",
  preferred_provider_id: null,
  default_knowledge_base_ids: [],
  memory_enabled: true,
};

export default function ProfilePage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [profile, setProfile] = useState<Profile>(defaults);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<Tenant>("/tenants/current"),
      api<Profile>("/ai/profile"),
      api<Provider[]>("/ai/providers"),
      api<KnowledgeBase[]>("/knowledge-bases"),
    ])
      .then(([org, personal, allProviders, knowledgeBases]) => {
        setTenant(org);
        setProfile(personal);
        setProviders(
          allProviders.filter((item) => item.kind === "llm" && item.is_active),
        );
        setBases(knowledgeBases);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function change<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  function toggleDefaultKB(id: string) {
    const current = profile.default_knowledge_base_ids;
    change(
      "default_knowledge_base_ids",
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved(false);
    try {
      await api("/ai/profile", {
        method: "PUT",
        body: JSON.stringify(profile),
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save preferences");
    }
  }

  return (
    <main className="app-shell">
      <AppSidebar active="profile" tenantName={tenant?.name} />

      <section className="app-main">
        <header className="app-topbar">
          <span>
            Configuration <i>/</i> Personal AI
          </span>
          <span className="live-label">
            <b /> Personal preferences
          </span>
        </header>
        <div className="app-content">
          <div className="list-page-heading">
            <div>
              <div className="eyebrow">YOUR ASSISTANT</div>
              <h1>Personal AI settings</h1>
              <p>
                Shape how Lumix communicates with you. These preferences never
                change shared knowledge.
              </p>
            </div>
          </div>
          {error && <div className="notice-error">{error}</div>}
          {saved && (
            <div className="notice-success">
              Your preferences have been saved.
            </div>
          )}

          {loading ? (
            <div className="empty-panel">Loading preferences…</div>
          ) : (
            <form className="create-panel profile-form" onSubmit={save}>
              <div className="profile-form-grid">
                <label>
                  Assistant name
                  <input
                    value={profile.assistant_name}
                    onChange={(e) => change("assistant_name", e.target.value)}
                  />
                </label>
                <label>
                  Personality
                  <input
                    value={profile.personality}
                    onChange={(e) => change("personality", e.target.value)}
                  />
                </label>
                <label>
                  Response language
                  <select
                    value={profile.language}
                    onChange={(e) => change("language", e.target.value)}
                  >
                    {[
                      "English",
                      "Hindi",
                      "Marathi",
                      "Spanish",
                      "French",
                      "German",
                    ].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Tone
                  <select
                    value={profile.tone}
                    onChange={(e) => change("tone", e.target.value)}
                  >
                    <option value="professional">Professional</option>
                    <option value="friendly">Friendly</option>
                    <option value="casual">Casual</option>
                  </select>
                </label>
                <label>
                  Answer length
                  <select
                    value={profile.answer_length}
                    onChange={(e) => change("answer_length", e.target.value)}
                  >
                    <option value="short">Short</option>
                    <option value="medium">Medium</option>
                    <option value="detailed">Detailed</option>
                  </select>
                </label>
                <label>
                  Technical level
                  <select
                    value={profile.technical_level}
                    onChange={(e) => change("technical_level", e.target.value)}
                  >
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="expert">Expert</option>
                  </select>
                </label>
                <label>
                  Preferred format
                  <select
                    value={profile.preferred_format}
                    onChange={(e) => change("preferred_format", e.target.value)}
                  >
                    <option value="paragraph">Paragraphs</option>
                    <option value="bullets">Bullet points</option>
                    <option value="tables">Tables</option>
                  </select>
                </label>
                <label>
                  Preferred chat model
                  <select
                    value={profile.preferred_provider_id ?? ""}
                    onChange={(e) =>
                      change("preferred_provider_id", e.target.value || null)
                    }
                  >
                    <option value="">Use workspace default</option>
                    {providers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="profile-section">
                <h3>Default knowledge bases</h3>
                <p>
                  Preselect these sources when you start a new conversation.
                  Access is still checked by the server.
                </p>
                {bases.length ? (
                  <div className="profile-kb-grid">
                    {bases.map((kb) => (
                      <label className="profile-kb-option" key={kb.id}>
                        <input
                          type="checkbox"
                          checked={profile.default_knowledge_base_ids.includes(
                            kb.id,
                          )}
                          onChange={() => toggleDefaultKB(kb.id)}
                        />
                        <span>
                          <b>{kb.name}</b>
                          <small>
                            {kb.visibility === "tenant"
                              ? "Workspace"
                              : "Restricted"}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p>No knowledge bases are available yet.</p>
                )}
              </div>

              <label>
                Custom instructions
                <textarea
                  rows={5}
                  maxLength={4000}
                  value={profile.custom_instructions}
                  onChange={(e) =>
                    change("custom_instructions", e.target.value)
                  }
                  placeholder="Tell Lumix how you prefer explanations, examples, or formatting."
                />
              </label>
              <label className="memory-toggle">
                <input
                  type="checkbox"
                  checked={profile.memory_enabled}
                  onChange={(e) => change("memory_enabled", e.target.checked)}
                />
                <span>
                  <b>Use conversation memory</b>
                  <small>
                    Keep recent messages as context within each conversation.
                    This never becomes shared knowledge.
                  </small>
                </span>
              </label>
              <button className="primary-button">
                Save preferences <span>→</span>
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
