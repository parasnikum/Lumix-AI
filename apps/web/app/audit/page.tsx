"use client";

import AppSidebar from "../components/AppSidebar";
import { useCallback, useEffect, useState } from "react";
import { api, Tenant } from "../lib/api";

type AuditItem = {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  created_at: string;
};
type AuditResponse = {
  items: AuditItem[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_previous: boolean;
  has_next: boolean;
};

export default function AuditPage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [items, setItems] = useState<AuditItem[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Tenant>("/tenants/current")
      .then(setTenant)
      .catch((e) => setError(e.message));
  }, []);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api<AuditResponse>(
        `/tenants/current/audit-logs?page=${page}&page_size=${pageSize}`,
      );
      setItems(result.items);
      setTotal(result.total);
      setTotalPages(result.total_pages);
      if (result.page !== page) setPage(result.page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load audit events");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);
  const visiblePages = Array.from(
    { length: totalPages },
    (_, index) => index + 1,
  ).filter((number) => number === 1 || number === totalPages || Math.abs(number - page) <= 1);

  return (
    <main className="app-shell">
      <AppSidebar active="audit" tenantName={tenant?.name} />
      <section className="app-main">
        <header className="app-topbar">
          <span>Workspace <i>/</i> Audit log</span>
          <span className="live-label"><b /> Security events</span>
        </header>
        <div className="app-content">
          <div className="list-page-heading">
            <div>
              <div className="eyebrow">ACTIVITY & SECURITY</div>
              <h1>Audit log</h1>
              <p>Organization-level records of administrative and content changes.</p>
            </div>
          </div>
          {error && <div className="notice-error">{error}</div>}
          <div className="audit-toolbar">
            <div>
              <strong>{total.toLocaleString()} events</strong>
              <span> · Showing {firstItem.toLocaleString()}–{lastItem.toLocaleString()}</span>
            </div>
            <label>
              <span>Rows per page</span>
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
          </div>
          {loading ? (
            <div className="empty-panel">Loading audit events…</div>
          ) : items.length ? (
            <>
              <div className="audit-table-wrap">
                <table className="audit-table">
                  <thead>
                    <tr>
                      <th scope="col">Action</th>
                      <th scope="col">Resource</th>
                      <th scope="col">Performed by</th>
                      <th scope="col">Date &amp; time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <span className="audit-action">
                            <span className="audit-dot" />
                            {item.action.replaceAll(".", " · ")}
                          </span>
                        </td>
                        <td>
                          <span className="audit-resource">{item.resource_type || "—"}</span>
                          {item.resource_id && <small className="audit-resource-id">{item.resource_id}</small>}
                        </td>
                        <td>
                          <span className="audit-actor">{item.actor_name ?? "System"}</span>
                          {item.actor_email && <small className="audit-actor-email">{item.actor_email}</small>}
                        </td>
                        <td>
                          <time className="audit-timestamp" dateTime={item.created_at}>
                            {new Date(item.created_at).toLocaleString()}
                          </time>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <nav className="pagination-bar" aria-label="Audit log pages">
                <span className="pagination-summary">Page {page} of {Math.max(totalPages, 1)}</span>
                <div className="pagination-controls">
                  <button disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
                  {visiblePages.map((number, index) => (
                    <span className="pagination-page-wrap" key={number}>
                      {index > 0 && number - visiblePages[index - 1] > 1 && <span className="pagination-ellipsis">…</span>}
                      <button className={number === page ? "current" : ""} aria-current={number === page ? "page" : undefined} onClick={() => setPage(number)} disabled={loading}>{number}</button>
                    </span>
                  ))}
                  <button disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button>
                </div>
              </nav>
            </>
          ) : (
            <div className="empty-panel">
              <h3>No audit events yet</h3>
              <p>Organization changes will be recorded here.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
