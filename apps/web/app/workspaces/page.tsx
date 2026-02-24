"use client";

import Link from "next/link";
import { Brand } from "../components/Brand";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Workspace = { id: string; name: string; slug: string; role: string };
export default function WorkspacesPage() {
  const [items, setItems] = useState<Workspace[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<Workspace[]>("/auth/workspaces")
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function switchWorkspace(id: string) {
    try {
      await api(`/auth/switch-tenant/${id}`, { method: "POST" });
      window.location.assign("/dashboard");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to switch organization",
      );
    }
  }
  return (
    <main className="app-shell">
      <aside className="app-sidebar">
        <Brand href="/dashboard" />
        <div className="nav-caption">ACCOUNT</div>
        <nav className="app-nav">
          <Link className="selected" href="/workspaces">
            <span>▦</span> Your workspaces
          </Link>
          <Link href="/dashboard">
            <span>◫</span> Current workspace
          </Link>
        </nav>
      </aside>
      <section className="app-main">
        <header className="app-topbar">
          <span>
            Account <i>/</i> Workspaces
          </span>
        </header>
        <div className="app-content">
          <div className="list-page-heading">
            <div>
              <div className="eyebrow">ORGANIZATION ACCESS</div>
              <h1>Your workspaces</h1>
              <p>Switch between organizations without signing out.</p>
            </div>
          </div>
          {error && <div className="notice-error">{error}</div>}
          {loading ? (
            <div className="empty-panel">Loading workspaces…</div>
          ) : (
            <div className="kb-list">
              {items.map((item) => (
                <article className="kb-list-row" key={item.id}>
                  <div className="member-avatar">{item.name[0]}</div>
                  <div className="kb-list-copy">
                    <strong>{item.name}</strong>
                    <p>
                      {item.slug} · {item.role.replaceAll("_", " ")}
                    </p>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => switchWorkspace(item.id)}
                  >
                    Open workspace <span>→</span>
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
