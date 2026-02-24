"use client";

import Link from "next/link";
import AppSidebar from "../components/AppSidebar";
import { Brand } from "../components/Brand";
import { useEffect, useState } from "react";
import { api, KnowledgeBase, Tenant } from "../lib/api";

export default function DashboardPage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [documentCount, setDocumentCount] = useState<number | null>(null);
  const [conversationCount, setConversationCount] = useState<number | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<Tenant>("/tenants/current"),
      api<KnowledgeBase[]>("/knowledge-bases"),
      api<{ id: string }[]>("/chats"),
    ])
      .then(async ([org, knowledgeBases, chats]) => {
        setTenant(org);
        setBases(knowledgeBases);
        setConversationCount(chats.length);
        const documentLists = await Promise.all(
          knowledgeBases.map((kb) =>
            api<{ id: string }[]>(`/knowledge-bases/${kb.id}/documents`),
          ),
        );
        setDocumentCount(
          documentLists.reduce(
            (total, documents) => total + documents.length,
            0,
          ),
        );
      })
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Unable to load workspace",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="app-shell">
      <AppSidebar active="dashboard" tenantName={tenant?.name} />
      <section className="app-main">
        <header className="app-topbar">
          <span>
            Workspace <i>/</i> Overview
          </span>
          <span className="live-label">
            <b /> Connected workspace
          </span>
        </header>
        <div className="app-content">
          <div className="page-intro">
            <div>
              <div className="eyebrow">WORKSPACE OVERVIEW</div>
              <h1>
                Your knowledge,
                <br />
                <em>within reach.</em>
              </h1>
              <p>
                Organize trusted information and give every answer a source.
              </p>
            </div>
            <div className="intro-symbol"><Brand compact /></div>
          </div>
          {error && <div className="notice-error">{error}</div>}
          <div className="content-heading">
            <div>
              <h2>Workspace at a glance</h2>
              <p>Live data from your organization</p>
            </div>
          </div>
          <div className="metric-grid">
            <article>
              <span>Knowledge bases</span>
              <strong>{loading ? "—" : bases.length}</strong>
              <small>Available to your account</small>
            </article>
            <article>
              <span>Documents</span>
              <strong>
                {loading || documentCount === null ? "—" : documentCount}
              </strong>
              <small>Across accessible knowledge bases</small>
            </article>
            <article>
              <span>Conversations</span>
              <strong>
                {loading || conversationCount === null
                  ? "—"
                  : conversationCount}
              </strong>
              <small>Your recent conversations</small>
            </article>
            <article>
              <span>Organization</span>
              <strong className="metric-org">
                {tenant?.name ?? (loading ? "—" : "Workspace")}
              </strong>
              <small>{tenant?.slug ?? ""}</small>
            </article>
          </div>
          <div className="content-heading heading-spaced">
            <div>
              <h2>Knowledge bases</h2>
              <p>Private collections of your organization's information</p>
            </div>
            <Link href="/knowledge-bases" className="secondary-button">
              View all <span>→</span>
            </Link>
          </div>
          {loading ? (
            <div className="empty-panel">Loading your knowledge bases…</div>
          ) : bases.length ? (
            <div className="kb-grid">
              {bases.slice(0, 3).map((kb) => (
                <Link
                  className="kb-card"
                  href={`/knowledge-bases/${kb.id}`}
                  key={kb.id}
                >
                  <div className="kb-card-icon">▤</div>
                  <span className="kb-visibility">
                    {kb.visibility === "tenant" ? "Workspace" : "Restricted"}
                  </span>
                  <h3>{kb.name}</h3>
                  <p>{kb.description || "No description added."}</p>
                  <small>
                    Open knowledge base <b>→</b>
                  </small>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-panel">
              <div className="empty-icon">▤</div>
              <h3>Your knowledge starts here.</h3>
              <p>
                Create a knowledge base, then upload documents to make them
                searchable.
              </p>
              <Link href="/knowledge-bases" className="primary-button">
                Create knowledge base <span>→</span>
              </Link>
            </div>
          )}
          <footer className="app-footer">
            <span>© 2026 Lumix</span>
            <span>Private knowledge. Clear answers.</span>
            <span>v0.3.0</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
