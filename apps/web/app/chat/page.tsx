"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api, KnowledgeBase, Tenant } from "../lib/api";
import { Brand } from "../components/Brand";
import { useTheme } from "../components/ThemeProvider";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
type Provider = { id: string; name: string; kind: string; is_active: boolean };
type Citation = {
  document_id: string;
  source_name: string;
  page_number: number | null;
  snippet: string;
};
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
};
type Conversation = { id: string; title: string; created_at: string };

function Icon({
  name,
}: {
  name:
    | "panel"
    | "plus"
    | "sun"
    | "moon"
    | "settings"
    | "database"
    | "search"
    | "message"
    | "spark"
    | "menu";
}) {
  const paths: Record<string, React.ReactNode> = {
    panel: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M9 4v16" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
      </>
    ),
    moon: <path d="M20.9 13A8.5 8.5 0 0 1 11 3.1 8.5 8.5 0 1 0 20.9 13Z" />,
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path
          d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.5.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.5-.9l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.8l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.5-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.5.9l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.8Z"
          transform="translate(-1 -1)"
        />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
      </>
    ),
    search: (
      <>
        <circle cx="10.8" cy="10.8" r="6.8" />
        <path d="m16 16 5 5" />
      </>
    ),
    message: (
      <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-2 2v-9.5A7.5 7.5 0 0 1 10.5 4H12a8 8 0 0 1 8 7.5Z" />
    ),
    spark: (
      <>
        <path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" />
        <path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />
      </>
    ),
    menu: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

export default function ChatPage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [providerId, setProviderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  async function load() {
    const [org, kb, models, chats, profile] = await Promise.all([
      api<Tenant>("/tenants/current"),
      api<KnowledgeBase[]>("/knowledge-bases"),
      api<Provider[]>("/ai/providers"),
      api<Conversation[]>("/chats"),
      api<{ default_knowledge_base_ids: string[] }>("/ai/profile"),
    ]);
    setTenant(org);
    setBases(kb);
    setProviders(models.filter((p) => p.kind === "llm" && p.is_active));
    setConversations(chats);
    if (!selected.length && kb.length) {
      const defaults = profile.default_knowledge_base_ids.filter((id) =>
        kb.some((item) => item.id === id),
      );
      setSelected(defaults.length ? defaults : [kb[0].id]);
    }
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setSidebarCollapsed(
      window.localStorage.getItem("lumix-sidebar") === "collapsed",
    );
  }, []);
  useEffect(() => {
    window.localStorage.setItem(
      "lumix-sidebar",
      sidebarCollapsed ? "collapsed" : "expanded",
    );
  }, [sidebarCollapsed]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  async function openConversation(id: string) {
    setError("");
    try {
      const detail = await api<{
        id: string;
        knowledge_base_ids: string[];
        messages: ChatMessage[];
      }>(`/chats/${id}`);
      setConversationId(id);
      setSelected(detail.knowledge_base_ids);
      setMessages(detail.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to open conversation");
    }
  }
  function toggleKb(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }
  async function newConversation() {
    if (!selected.length) {
      setError("Select at least one knowledge base first.");
      return;
    }
    try {
      const created = await api<{
        id: string;
        title: string;
        created_at: string;
      }>("/chats", {
        method: "POST",
        body: JSON.stringify({
          title: "New conversation",
          knowledge_base_ids: selected,
        }),
      });
      setConversationId(created.id);
      setMessages([]);
      await refreshConversations();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to create conversation",
      );
    }
  }
  async function refreshConversations() {
    const list = await api<Conversation[]>("/chats");
    setConversations(list);
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = question.trim();
    if (!content || loading) return;
    setError("");
    if (!selected.length) {
      setError("Select at least one knowledge base first.");
      return;
    }
    let activeId = conversationId;
    if (!activeId) {
      if (!selected.length) {
        setError("Select at least one knowledge base first.");
        return;
      }
      try {
        const created = await api<{ id: string }>("/chats", {
          method: "POST",
          body: JSON.stringify({
            title: content.slice(0, 60),
            knowledge_base_ids: selected,
          }),
        });
        activeId = created.id;
        setConversationId(activeId);
        await refreshConversations();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Unable to create conversation",
        );
        return;
      }
    }
    try {
      await api(`/chats/${activeId}/knowledge-bases`, {
        method: "PUT",
        body: JSON.stringify(selected),
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to update knowledge sources",
      );
      return;
    }
    setQuestion("");
    setLoading(true);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content },
      { id: "streaming", role: "assistant", content: "", citations: [] },
    ]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const request = () =>
        fetch(`${API_URL}/chats/${activeId}/messages`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, provider_id: providerId || null }),
          signal: controller.signal,
        });
      let response = await request();
      if (response.status === 401) {
        try {
          await api("/auth/refresh", { method: "POST" });
          response = await request();
        } catch {
          window.location.assign("/login");
          return;
        }
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Unable to send message");
      }
      if (!response.body)
        throw new Error("Streaming is not supported by this connection");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const raw of events) {
          const line = raw.split("\n").find((x) => x.startsWith("data: "));
          if (!line) continue;
          const data = JSON.parse(line.slice(6));
          if (data.type === "token")
            setMessages((current) =>
              current.map((m) =>
                m.id === "streaming"
                  ? { ...m, content: m.content + data.content }
                  : m,
              ),
            );
          if (data.type === "done")
            setMessages((current) =>
              current.map((m) =>
                m.id === "streaming"
                  ? { ...m, citations: data.citations ?? [] }
                  : m,
              ),
            );
          if (data.type === "error") setError(data.message);
        }
      }
      setMessages((current) =>
        current.map((m) =>
          m.id === "streaming" ? { ...m, id: crypto.randomUUID() } : m,
        ),
      );
      await refreshConversations();
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") setError(e.message);
      setMessages((current) =>
        current.filter((m) => m.id !== "streaming" || m.content),
      );
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }
  async function deleteConversation(id: string) {
    try {
      await api(`/chats/${id}`, { method: "DELETE" });
      setConversations((items) => items.filter((x) => x.id !== id));
      if (conversationId === id) {
        setConversationId("");
        setMessages([]);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to delete conversation",
      );
    }
  }
  async function openSource(documentId: string) {
    try {
      const result = await api<{ url: string }>(
        `/documents/${documentId}/download`,
      );
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to open source document",
      );
    }
  }
  async function signOut() {
    await api("/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }
  return (
    <main
      className={`chat-shell ${theme === "dark" ? "theme-dark" : "theme-light"} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${mobileSidebarOpen ? "mobile-sidebar-open" : ""}`}
    >
      <aside className="chat-sidebar">
        <div className="chat-brand-row">
          <Brand href="/dashboard" />
          <button
            className="sidebar-collapse"
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon name="panel" />
          </button>
        </div>
        <button
          className="new-chat-button"
          onClick={newConversation}
          title="New conversation"
        >
          <Icon name="plus" /> <span>New chat</span>
        </button>
        <div className="chat-nav-links">
          <Link href="/dashboard">
            <Icon name="database" />
            <span>Workspace</span>
          </Link>
          <button
            onClick={() =>
              document
                .querySelector<HTMLInputElement>(".conversation-search")
                ?.focus()
            }
          >
            <Icon name="search" />
            <span>Search chats</span>
            <kbd>⌘ K</kbd>
          </button>
        </div>
        <div className="chat-side-label">YOUR CHATS</div>
        <input
          className="conversation-search"
          placeholder="Filter conversations…"
          aria-label="Filter conversations"
          onChange={(e) => {
            const q = e.target.value.toLowerCase();
            document
              .querySelectorAll<HTMLElement>(".conversation-row")
              .forEach((row) => {
                row.hidden = !row.innerText.toLowerCase().includes(q);
              });
          }}
        />
        <div className="conversation-list">
          {conversations.map((c) => (
            <div
              className={
                conversationId === c.id
                  ? "conversation-row active"
                  : "conversation-row"
              }
              key={c.id}
            >
              <button onClick={() => openConversation(c.id)}>{c.title}</button>
              <button
                className="delete-chat"
                title="Delete conversation"
                onClick={() => deleteConversation(c.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="chat-sidebar-bottom">
          <span className="workspace-avatar">{tenant?.name?.[0] ?? "W"}</span>
          <span className="workspace-name">
            {tenant?.name ?? "Workspace"}
            <small>Workspace plan</small>
          </span>
          <Link href="/profile" className="chat-profile-link" title="Profile">
            ◎
          </Link>
          <button onClick={signOut} title="Log out">
            ↗
          </button>
        </div>
      </aside>
      {mobileSidebarOpen && (
        <button
          className="mobile-sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <section className="chat-main">
        <header className="chat-topbar">
          <div className="topbar-leading">
            <button
              className="mobile-menu-button"
              onClick={() => setMobileSidebarOpen((v) => !v)}
              aria-label="Open navigation"
            >
              <Icon name="menu" />
            </button>
            <button
              className="topbar-sidebar-toggle"
              onClick={() => setSidebarCollapsed((v) => !v)}
              title="Toggle sidebar"
            >
              <Icon name="panel" />
            </button>
            <div className="chat-model-heading">
              <span className="model-dot" />
              <span className="model-title-copy">
                <strong>Lumix Assistant</strong>
                <small>
                  {conversationId ? "Your conversation" : "Knowledge workspace"}
                </small>
              </span>
              <span className="model-chevron">⌄</span>
            </div>
            <label
              className="provider-inline-wrap"
              aria-label="Select chat model"
            >
              <span>Model</span>
              <select
                className="provider-inline-select"
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                title="Switch chat model"
              >
                <option value="">Personal default</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {contextOpen && (
            <div
              className="chat-settings-menu"
              role="dialog"
              aria-label="Chat settings"
            >
              <section className="settings-menu-section">
                <div className="context-heading">
                  <strong>Knowledge sources</strong>
                  <span>{selected.length} selected</span>
                </div>
                <p>
                  Choose the collections Lumix can search in this conversation.
                </p>
                {bases.length ? (
                  bases.map((kb) => (
                    <label className="kb-check" key={kb.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(kb.id)}
                        onChange={() => toggleKb(kb.id)}
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
                  ))
                ) : (
                  <div className="context-empty">
                    No knowledge bases available.{" "}
                    <Link href="/knowledge-bases">Create one</Link>
                  </div>
                )}
                <Link href="/settings/providers" className="manage-models-link">
                  Manage providers <span>↗</span>
                </Link>
              </section>
            </div>
          )}
          <div className="topbar-actions">
            <button
              className="icon-button"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
              aria-label="Switch theme"
            >
              <Icon name={theme === "light" ? "moon" : "sun"} />
            </button>
            <button
              className={`icon-button settings-trigger ${contextOpen ? "is-active" : ""}`}
              onClick={() => setContextOpen((v) => !v)}
              title="Chat settings"
              aria-label="Open chat settings"
              aria-expanded={contextOpen}
            >
              <Icon name="settings" />
              <span>Settings</span>
            </button>
          </div>
        </header>
        <div className="chat-layout">
          <section className="chat-thread">
            {messages.length === 0 ? (
              <div className="chat-welcome">
                <div className="welcome-visual">
                  <div className="welcome-orbit orbit-one" />
                  <div className="welcome-orbit orbit-two" />
                  <Brand
                    compact={false}
                    href="/dashboard"
                    className="welcome-brand-mark"
                  />
                  <span className="welcome-spark spark-one">✦</span>
                  <span className="welcome-spark spark-two">✧</span>
                </div>
                <div className="eyebrow">YOUR KNOWLEDGE, IN CONVERSATION</div>
                <h1>
                  What can I help you
                  <br />
                  <em>discover today?</em>
                </h1>
                <p>
                  Explore your team's knowledge, connect the dots, and get clear
                  answers grounded in your own sources.
                </p>
                <div className="welcome-feature-grid">
                  <div>
                    <span className="feature-icon feature-blue">
                      <Icon name="database" />
                    </span>
                    <b>Knowledge-aware</b>
                    <small>Answers from your sources</small>
                  </div>
                  <div>
                    <span className="feature-icon feature-violet">
                      <Icon name="spark" />
                    </span>
                    <b>Context that connects</b>
                    <small>Across selected collections</small>
                  </div>
                  <div>
                    <span className="feature-icon feature-teal">
                      <Icon name="message" />
                    </span>
                    <b>Built for teams</b>
                    <small>Private by design</small>
                  </div>
                </div>
                <div className="suggestion-row">
                  <button
                    onClick={() =>
                      setQuestion(
                        "Summarize the key points in these documents.",
                      )
                    }
                  >
                    Summarize these documents
                  </button>
                  <button
                    onClick={() =>
                      setQuestion(
                        "What are the most important policies I should know?",
                      )
                    }
                  >
                    Find important policies
                  </button>
                </div>
              </div>
            ) : (
              <div className="message-list">
                {messages.map((m) => (
                  <article
                    className={
                      m.role === "user"
                        ? "message user-message"
                        : "message assistant-message"
                    }
                    key={m.id}
                  >
                    <div className="message-avatar">
                      {m.role === "user" ? "You" : "L"}
                    </div>
                    <div className="message-body">
                      <div className="message-role">
                        {m.role === "user" ? "You" : "Lumix"}
                      </div>
                      <div className="message-content">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ href, children }) => (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {children}
                              </a>
                            ),
                          }}
                        >
                          {m.content || (loading ? "Thinking…" : "")}
                        </ReactMarkdown>
                      </div>
                      {m.citations && m.citations.length > 0 && (
                        <div className="citation-hover">
                          <button
                            className="citation-count"
                            type="button"
                            aria-label={`View ${m.citations.length} sources`}
                          >
                            <Icon name="database" /> <span>Sources</span>{" "}
                            <b>{m.citations.length}</b>
                          </button>
                          <div className="citation-popover" role="tooltip">
                            <div className="citation-popover-head">
                              <strong>Sources used</strong>
                              <span>{m.citations.length} references</span>
                            </div>
                            <div className="citation-popover-list">
                              {m.citations.map((c, i) => (
                                <div
                                  className="citation-popover-item"
                                  key={`${c.document_id}-${c.page_number}-${i}`}
                                >
                                  <div className="citation-source-title">
                                    <b>
                                      {i + 1}. {c.source_name}
                                    </b>
                                    {c.page_number && (
                                      <small>Page {c.page_number}</small>
                                    )}
                                  </div>
                                  {c.snippet && <p>{c.snippet}</p>}
                                  <button
                                    className="citation-open"
                                    onClick={() => openSource(c.document_id)}
                                  >
                                    Open source <span>↗</span>
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                      {m.role === "assistant" && m.content && (
                        <button
                          className="copy-action"
                          onClick={() =>
                            navigator.clipboard.writeText(m.content)
                          }
                        >
                          Copy response
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </section>
        </div>
        <form className="chat-composer" onSubmit={send}>
          <div className="composer-context">
            <span className="composer-status" /> Lumix is ready <span>·</span>{" "}
            {selected.length} knowledge{" "}
            {selected.length === 1 ? "source" : "sources"}
          </div>
          <textarea
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask a question about your knowledge…"
            disabled={loading}
          />
          <div className="composer-bottom">
            <span>Enter to send · Shift + Enter for a new line</span>
            {loading ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => abortRef.current?.abort()}
              >
                Stop
              </button>
            ) : (
              <button className="primary-button" disabled={!question.trim()}>
                Send <span>↑</span>
              </button>
            )}
          </div>
        </form>
        {error && <div className="chat-error">{error}</div>}
      </section>
    </main>
  );
}
