"use client";

import Link from "next/link";
import AppSidebar from "../../components/AppSidebar";
import { ChangeEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, KnowledgeBase, Tenant } from "../../lib/api";

type DocumentItem = {
  id: string;
  filename: string;
  size_bytes: number;
  status: string;
  version_number: number;
  error_message: string | null;
  created_at: string;
};
type DocumentVersionItem = {
  version_number: number;
  filename: string;
  size_bytes: number;
  created_at: string;
};
type Member = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
};
type KBAccess = {
  user_id: string;
  email: string;
  full_name: string;
  can_manage: boolean;
};

export default function KnowledgeBaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [assigned, setAssigned] = useState<KBAccess[]>([]);
  const [canManageAccess, setCanManageAccess] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);
  const [expandedVersions, setExpandedVersions] = useState("");
  const [versions, setVersions] = useState<DocumentVersionItem[]>([]);

  async function load() {
    const [org, base, documents] = await Promise.all([
      api<Tenant>("/tenants/current"),
      api<KnowledgeBase>(`/knowledge-bases/${id}`),
      api<DocumentItem[]>(`/knowledge-bases/${id}/documents`),
    ]);
    setTenant(org);
    setKb(base);
    setDocs(documents);

    try {
      const [team, access] = await Promise.all([
        api<Member[]>("/tenants/current/users"),
        api<KBAccess[]>(`/knowledge-bases/${id}/users`),
      ]);
      setMembers(team.filter((member) => member.is_active));
      setAssigned(access);
      setCanManageAccess(true);
    } catch {
      setCanManageAccess(false);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (
      !docs.some((document) =>
        ["queued", "processing"].includes(document.status),
      )
    )
      return;
    const timer = window.setInterval(() => {
      api<DocumentItem[]>(`/knowledge-bases/${id}/documents`)
        .then(setDocs)
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [docs, id]);

  async function openDocument(documentId: string) {
    try {
      const result = await api<{ url: string }>(
        `/documents/${documentId}/download`,
      );
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to download document");
    }
  }

  async function toggleVersions(documentId: string) {
    if (expandedVersions === documentId) {
      setExpandedVersions("");
      return;
    }
    try {
      const result = await api<DocumentVersionItem[]>(
        `/documents/${documentId}/versions`,
      );
      setVersions(result);
      setExpandedVersions(documentId);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load document history",
      );
    }
  }

  async function uploadVersion(
    documentId: string,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const form = new FormData();
      form.append("file", file);
      await api(`/documents/${documentId}/versions`, {
        method: "POST",
        body: form,
      });
      await load();
      if (expandedVersions === documentId) {
        setVersions(
          await api<DocumentVersionItem[]>(`/documents/${documentId}/versions`),
        );
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to upload a new version",
      );
    } finally {
      event.target.value = "";
    }
  }

  async function openVersion(documentId: string, versionNumber: number) {
    try {
      const result = await api<{ url: string }>(
        `/documents/${documentId}/versions/${versionNumber}/download`,
      );
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to open document version",
      );
    }
  }

  async function reprocessDocument(documentId: string) {
    try {
      await api(`/documents/${documentId}/reprocess`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to reprocess document");
    }
  }

  async function deleteDocument(documentId: string, filename: string) {
    if (
      !window.confirm(
        `Delete ${filename}? This also removes its indexed content.`,
      )
    )
      return;
    try {
      await api(`/documents/${documentId}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete document");
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;

    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      await api(`/knowledge-bases/${id}/documents`, {
        method: "POST",
        body: form,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  function toggleAssigned(userId: string) {
    setAssigned((current) => {
      const existing = current.find((item) => item.user_id === userId);
      return existing
        ? current.filter((item) => item.user_id !== userId)
        : [
            ...current,
            {
              user_id: userId,
              email:
                members.find((member) => member.id === userId)?.email ?? "",
              full_name:
                members.find((member) => member.id === userId)?.full_name ?? "",
              can_manage: false,
            },
          ];
    });
  }

  function toggleManage(userId: string) {
    setAssigned((current) =>
      current.map((item) =>
        item.user_id === userId
          ? { ...item, can_manage: !item.can_manage }
          : item,
      ),
    );
  }

  async function saveAccess() {
    setSavingAccess(true);
    setError("");
    try {
      await api(`/knowledge-bases/${id}/users`, {
        method: "PUT",
        body: JSON.stringify(
          assigned.map(({ user_id, can_manage }) => ({ user_id, can_manage })),
        ),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save access");
    } finally {
      setSavingAccess(false);
    }
  }

  return (
    <main className="app-shell">
      <AppSidebar active="knowledge-bases" tenantName={tenant?.name} />

      <section className="app-main">
        <header className="app-topbar">
          <span>
            <Link href="/knowledge-bases">Knowledge bases</Link> <i>/</i>{" "}
            {kb?.name ?? "Loading…"}
          </span>
          <span className="live-label">
            <b /> Connected workspace
          </span>
        </header>

        <div className="app-content">
          {error && <div className="notice-error">{error}</div>}

          <div className="list-page-heading">
            <div>
              <div className="eyebrow">KNOWLEDGE BASE</div>
              <h1>{kb?.name ?? "Loading…"}</h1>
              <p>
                {kb?.description ||
                  "Manage the source documents used by your AI assistant."}
              </p>
            </div>
            <label className="primary-button upload-button">
              {uploading ? "Uploading…" : "Upload documents"} <span>↑</span>
              <input
                type="file"
                accept=".pdf,.docx,.pptx,.txt,.md,.csv,.xlsx,.html,.htm,.json"
                multiple
                onChange={upload}
                disabled={uploading}
              />
            </label>
          </div>

          <div className="detail-meta">
            <span>
              {kb?.visibility === "tenant"
                ? "Workspace access"
                : "Restricted access"}
            </span>
            <span>Embedding: {kb?.embedding_model ?? "—"}</span>
            <span>Chunk size: {kb?.chunk_size ?? "—"}</span>
            <span>Overlap: {kb?.chunk_overlap ?? "—"}</span>
            <span>Top K: {kb?.retrieval_top_k ?? "—"}</span>
          </div>

          {canManageAccess && (
            <section className="create-panel access-panel">
              <div className="content-heading">
                <div>
                  <h2>Knowledge base access</h2>
                  <p>
                    Assign members and optionally grant document-management
                    access.
                  </p>
                </div>
                <button
                  className="primary-button"
                  onClick={saveAccess}
                  disabled={savingAccess}
                >
                  {savingAccess ? "Saving…" : "Save access"}
                </button>
              </div>
              {members.length ? (
                members.map((member) => {
                  const access = assigned.find(
                    (item) => item.user_id === member.id,
                  );
                  return (
                    <div className="access-row" key={member.id}>
                      <label className="access-member">
                        <input
                          type="checkbox"
                          checked={Boolean(access)}
                          onChange={() => toggleAssigned(member.id)}
                        />
                        <span>
                          <b>{member.full_name}</b>
                          <small>{member.email}</small>
                        </span>
                      </label>
                      <label
                        className={
                          access ? "access-manager enabled" : "access-manager"
                        }
                      >
                        <input
                          type="checkbox"
                          disabled={!access}
                          checked={Boolean(access?.can_manage)}
                          onChange={() => toggleManage(member.id)}
                        />
                        Can manage
                      </label>
                    </div>
                  );
                })
              ) : (
                <p className="context-empty">
                  No active members are available.
                </p>
              )}
            </section>
          )}

          <div className="content-heading heading-spaced">
            <div>
              <h2>Source documents</h2>
              <p>
                Files are processed in the background and become searchable when
                ready.
              </p>
            </div>
            <span className="count-pill">{docs.length} documents</span>
          </div>

          {docs.length ? (
            <div className="kb-list">
              {docs.map((doc) => (
                <div className="document-entry" key={doc.id}>
                  <article className="kb-list-row">
                    <div className="file-type">FILE</div>
                    <div className="kb-list-copy">
                      <strong>{doc.filename}</strong>
                      <p>
                        v{doc.version_number} ·{" "}
                        {(doc.size_bytes / 1024 / 1024).toFixed(2)} MB ·{" "}
                        {new Date(doc.created_at).toLocaleDateString()}
                      </p>
                      {doc.error_message && (
                        <small className="form-error">
                          {doc.error_message}
                        </small>
                      )}
                    </div>
                    <span className={`doc-status status-${doc.status}`}>
                      {doc.status}
                    </span>
                    <div className="document-actions">
                      <button
                        className="text-action"
                        onClick={() => openDocument(doc.id)}
                      >
                        Open
                      </button>
                      <button
                        className="text-action"
                        onClick={() => toggleVersions(doc.id)}
                      >
                        Versions
                      </button>
                      <label className="text-action upload-version">
                        New version
                        <input
                          type="file"
                          accept=".pdf,.docx,.pptx,.txt,.md,.csv,.xlsx,.html,.htm,.json"
                          onChange={(event) => uploadVersion(doc.id, event)}
                        />
                      </label>
                      {!["queued", "processing"].includes(doc.status) && (
                        <button
                          className="text-action"
                          onClick={() => reprocessDocument(doc.id)}
                        >
                          {doc.status === "failed" ? "Retry" : "Reindex"}
                        </button>
                      )}
                      <button
                        className="text-action danger-action"
                        onClick={() => deleteDocument(doc.id, doc.filename)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                  {expandedVersions === doc.id && (
                    <div className="version-list">
                      {versions.map((version) => (
                        <div
                          className="version-row"
                          key={version.version_number}
                        >
                          <span>Version {version.version_number}</span>
                          <small>
                            {version.filename} ·{" "}
                            {(version.size_bytes / 1024 / 1024).toFixed(2)} MB
                          </small>
                          <button
                            className="text-action"
                            onClick={() =>
                              openVersion(doc.id, version.version_number)
                            }
                          >
                            Download
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-panel">
              <div className="empty-icon">↑</div>
              <h3>No source documents</h3>
              <p>
                Upload PDF, DOCX, PPTX, TXT, Markdown, CSV, XLSX, HTML or JSON
                files to begin indexing this knowledge base.
              </p>
              <label className="secondary-button upload-button">
                Choose documents
                <input
                  type="file"
                  accept=".pdf,.docx,.pptx,.txt,.md,.csv,.xlsx,.html,.htm,.json"
                  multiple
                  onChange={upload}
                  disabled={uploading}
                />
              </label>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
