"use client";

import AppSidebar from "../components/AppSidebar";
import { FormEvent, useEffect, useState } from "react";
import { api, Tenant } from "../lib/api";

type Member = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  can_transfer_ownership: boolean;
  can_invite: boolean;
  can_invite_admin: boolean;
  can_manage_members: boolean;
};
export default function TeamPage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [canInvite, setCanInvite] = useState(false);
  const [canInviteAdmin, setCanInviteAdmin] = useState(false);
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [inviteUrl, setInviteUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    const [org, list] = await Promise.all([
      api<Tenant>("/tenants/current"),
      api<Member[]>("/tenants/current/users"),
    ]);
    setTenant(org);
    setMembers(list);
    setCanInvite(list[0]?.can_invite ?? false);
    setCanInviteAdmin(list[0]?.can_invite_admin ?? false);
    setCanManageMembers(list[0]?.can_manage_members ?? false);
  }
  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInviteUrl("");
    try {
      const result = await api<{ invitation_token: string }>(
        "/tenants/current/invitations",
        { method: "POST", body: JSON.stringify({ email, role }) },
      );
      setInviteUrl(
        `${window.location.origin}/invite?token=${encodeURIComponent(result.invitation_token)}`,
      );
      setEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create invitation");
    }
  }
  async function transferOwnership(member: Member) {
    if (
      !window.confirm(
        `Transfer organization ownership to ${member.full_name}? Your role will become Administrator.`,
      )
    )
      return;
    setError("");
    try {
      await api(`/tenants/current/transfer-ownership/${member.id}`, {
        method: "POST",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to transfer ownership");
    }
  }

  async function update(member: Member, changes: Partial<Member>) {
    setError("");
    try {
      await api(`/tenants/current/users/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update member");
    }
  }
  return (
    <main className="app-shell">
      <AppSidebar active="team" tenantName={tenant?.name} />
      <section className="app-main">
        <header className="app-topbar">
          <span>
            Workspace <i>/</i> Team members
          </span>
          <span className="live-label">
            <b /> Organization access
          </span>
        </header>
        <div className="app-content">
          <div className="list-page-heading">
            <div>
              <div className="eyebrow">ACCESS MANAGEMENT</div>
              <h1>Team members</h1>
              <p>Manage who can access this organization's knowledge.</p>
            </div>
          </div>
          {error && <div className="notice-error">{error}</div>}
          {canInvite && (
            <form className="create-panel invite-form" onSubmit={invite}>
              <h2>Invite a teammate</h2>
              <div className="invite-fields">
                <label>
                  Email address
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="teammate@company.com"
                  />
                </label>
                <label>
                  Role
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                    <option value="knowledge_manager">Knowledge manager</option>
                    {canInviteAdmin && (
                      <option value="admin">Administrator</option>
                    )}
                  </select>
                </label>
                <button className="primary-button">
                  Create invitation <span>→</span>
                </button>
              </div>
              <small>
                Invitations are generated as secure, single-use links. Share the
                link with the invited person.
              </small>
              {inviteUrl && (
                <div className="invite-link">
                  <input readOnly value={inviteUrl} />
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => navigator.clipboard.writeText(inviteUrl)}
                  >
                    Copy link
                  </button>
                </div>
              )}
            </form>
          )}
          <div className="content-heading heading-spaced">
            <div>
              <h2>Organization members</h2>
              <p>{members.length} accounts</p>
            </div>
          </div>
          {loading ? (
            <div className="empty-panel">Loading members…</div>
          ) : (
            <div className="kb-list">
              {members.map((m) => (
                <article className="kb-list-row member-row" key={m.id}>
                  <div className="member-avatar">
                    {m.full_name[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div className="kb-list-copy">
                    <strong>{m.full_name}</strong>
                    <p>{m.email}</p>
                  </div>
                  <span
                    className={
                      m.is_active ? "provider-active" : "provider-inactive"
                    }
                  >
                    {m.is_active ? "Active" : "Inactive"}
                  </span>
                  {canManageMembers && (
                    <select
                      aria-label={`Role for ${m.full_name}`}
                      value={m.role}
                      onChange={(e) => update(m, { role: e.target.value })}
                    >
                      <option value="owner" disabled>Owner</option>
                      <option value="admin">Administrator</option>
                      <option value="knowledge_manager">Knowledge manager</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  )}
                  {m.can_transfer_ownership && (
                    <button
                      className="text-action"
                      onClick={() => transferOwnership(m)}
                    >
                      Make owner
                    </button>
                  )}
                  {canManageMembers && (
                    <button
                      className="text-action"
                      onClick={() => update(m, { is_active: !m.is_active })}
                    >
                      {m.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
