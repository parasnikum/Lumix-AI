"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Brand } from "../components/Brand";
import { api } from "../lib/api";

type Metrics = {
  tenants: number;
  active_tenants: number;
  users: number;
  knowledge_bases: number;
  documents: number;
  conversations: number;
};
type TenantRow = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  active_users: number;
};

export default function PlatformPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [invitation, setInvitation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    const [overview, list] = await Promise.all([
      api<Metrics>("/platform/overview"),
      api<TenantRow[]>("/platform/tenants"),
    ]);
    setMetrics(overview);
    setTenants(list);
  }
  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInvitation("");
    try {
      const result = await api<{
        invitation_token: string | null;
        slug: string;
      }>("/platform/tenants", {
        method: "POST",
        body: JSON.stringify({ name, owner_email: ownerEmail }),
      });
      if (result.invitation_token)
        setInvitation(
          `${window.location.origin}/invite?token=${encodeURIComponent(result.invitation_token)}`,
        );
      setName("");
      setOwnerEmail("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create tenant");
    }
  }
  async function toggle(tenant: TenantRow) {
    try {
      await api(`/platform/tenants/${tenant.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !tenant.is_active }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update tenant");
    }
  }
  async function signOut() {
    await api("/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }
  return (
    <main className="app-shell">
      <aside className="app-sidebar">
        <Brand href="/platform" />
        <div className="workspace-chip">
          <span className="workspace-avatar">S</span>
          <span>
            <b>Platform console</b>
            <small>Super administrator</small>
          </span>
        </div>
        <div className="nav-caption">PLATFORM</div>
        <nav className="app-nav">
          <Link className="selected" href="/platform">
            <span>◫</span> Overview
          </Link>
        </nav>
        <div className="sidebar-footer">
          <button onClick={signOut}>Sign out ↗</button>
        </div>
      </aside>
      <section className="app-main">
        <header className="app-topbar">
          <span>
            Platform <i>/</i> Overview
          </span>
          <span className="live-label">
            <b /> Administrator
          </span>
        </header>
        <div className="app-content">
          <div className="list-page-heading">
            <div>
              <div className="eyebrow">PLATFORM ADMINISTRATION</div>
              <h1>Organizations</h1>
              <p>
                Manage tenant workspaces and monitor platform-wide activity.
              </p>
            </div>
          </div>
          {error && <div className="notice-error">{error}</div>}
          <div className="metric-grid">
            <article>
              <span>Total tenants</span>
              <strong>{metrics?.tenants ?? "—"}</strong>
              <small>Registered organizations</small>
            </article>
            <article>
              <span>Active tenants</span>
              <strong>{metrics?.active_tenants ?? "—"}</strong>
              <small>Currently enabled</small>
            </article>
            <article>
              <span>Users</span>
              <strong>{metrics?.users ?? "—"}</strong>
              <small>Across all tenants</small>
            </article>
            <article>
              <span>Documents</span>
              <strong>{metrics?.documents ?? "—"}</strong>
              <small>Uploaded source files</small>
            </article>
          </div>
          <div className="platform-columns">
            <form className="create-panel" onSubmit={create}>
              <h2>Create organization</h2>
              <label>
                Organization name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                />
              </label>
              <label>
                Owner email
                <input
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  required
                />
              </label>
              <button className="primary-button">
                Create tenant <span>→</span>
              </button>
              {invitation && (
                <div className="invite-link">
                  <input readOnly value={invitation} />
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => navigator.clipboard.writeText(invitation)}
                  >
                    Copy owner invite
                  </button>
                </div>
              )}
            </form>
            <section>
              <div className="content-heading">
                <div>
                  <h2>All organizations</h2>
                  <p>{tenants.length} tenant records</p>
                </div>
              </div>
              {loading ? (
                <div className="empty-panel">Loading tenants…</div>
              ) : (
                <div className="kb-list">
                  {tenants.map((tenant) => (
                    <article className="kb-list-row" key={tenant.id}>
                      <div className="member-avatar">{tenant.name[0]}</div>
                      <div className="kb-list-copy">
                        <strong>{tenant.name}</strong>
                        <p>
                          {tenant.slug} · {tenant.active_users} active users
                        </p>
                      </div>
                      <span
                        className={
                          tenant.is_active
                            ? "provider-active"
                            : "provider-inactive"
                        }
                      >
                        {tenant.is_active ? "Active" : "Disabled"}
                      </span>
                      <button
                        className="text-action"
                        onClick={() => toggle(tenant)}
                      >
                        {tenant.is_active ? "Disable" : "Enable"}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
