"use client";

import AppSidebar from "../components/AppSidebar";
import { useEffect, useState } from "react";
import { api, Tenant } from "../lib/api";

type Analytics = {
  period_days: number;
  totals: { requests: number; input_tokens: number; output_tokens: number };
  daily: { date: string; requests: number; tokens: number }[];
  top_users: { name: string; requests: number; tokens: number }[];
  document_status: { status: string; count: number }[];
  knowledge_bases: { name: string; documents: number }[];
};

export default function AnalyticsPage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<Tenant>("/tenants/current")
      .then(setTenant)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setLoading(true);
    api<Analytics>(`/analytics/overview?days=${days}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days]);
  const maxTokens = Math.max(
    1,
    ...(data?.daily.map((item) => item.tokens) ?? []),
  );
  return (
    <main className="app-shell">
      <AppSidebar active="analytics" tenantName={tenant?.name} />
      <section className="app-main">
        <header className="app-topbar">
          <span>
            Workspace <i>/</i> Usage analytics
          </span>
          <span className="live-label">
            <b /> Usage tracking
          </span>
        </header>
        <div className="app-content">
          <div className="list-page-heading">
            <div>
              <div className="eyebrow">WORKSPACE INSIGHTS</div>
              <h1>Usage analytics</h1>
              <p>
                Track AI activity, token consumption and document processing. No
                billing data is collected.
              </p>
            </div>
            <select
              className="period-select"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
          {error && <div className="notice-error">{error}</div>}
          {loading ? (
            <div className="empty-panel">Loading usage data…</div>
          ) : (
            data && (
              <>
                <div className="metric-grid">
                  <article>
                    <span>AI requests</span>
                    <strong>{data.totals.requests.toLocaleString()}</strong>
                    <small>During selected period</small>
                  </article>
                  <article>
                    <span>Input tokens</span>
                    <strong>{data.totals.input_tokens.toLocaleString()}</strong>
                    <small>Estimated from model tokenizer</small>
                  </article>
                  <article>
                    <span>Output tokens</span>
                    <strong>
                      {data.totals.output_tokens.toLocaleString()}
                    </strong>
                    <small>Estimated from model tokenizer</small>
                  </article>
                  <article>
                    <span>Documents</span>
                    <strong>
                      {data.document_status.reduce(
                        (sum, item) => sum + item.count,
                        0,
                      )}
                    </strong>
                    <small>All uploaded documents</small>
                  </article>
                </div>
                <div className="analytics-columns">
                  <section className="create-panel analytics-panel">
                    <div className="content-heading">
                      <div>
                        <h2>Daily token usage</h2>
                        <p>Estimated input + output tokens</p>
                      </div>
                    </div>
                    <div className="usage-bars">
                      {data.daily.map((item) => (
                        <div className="usage-bar-column" key={item.date}>
                          <div className="usage-bar-track">
                            <div
                              className="usage-bar-fill"
                              style={{
                                height: `${Math.max(2, (item.tokens / maxTokens) * 100)}%`,
                              }}
                            />
                          </div>
                          <small>
                            {new Date(item.date).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                          </small>
                          <b>{item.tokens.toLocaleString()}</b>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="create-panel analytics-panel">
                    <div className="content-heading">
                      <div>
                        <h2>Document processing</h2>
                        <p>Current processing state</p>
                      </div>
                    </div>
                    {data.document_status.length ? (
                      data.document_status.map((item) => (
                        <div className="analytics-row" key={item.status}>
                          <span className={`doc-status status-${item.status}`}>
                            {item.status}
                          </span>
                          <b>{item.count}</b>
                        </div>
                      ))
                    ) : (
                      <p className="context-empty">
                        No documents uploaded yet.
                      </p>
                    )}
                  </section>
                </div>
                <div className="analytics-columns">
                  <section className="create-panel analytics-panel">
                    <div className="content-heading">
                      <div>
                        <h2>Most active members</h2>
                        <p>Ranked by AI requests</p>
                      </div>
                    </div>
                    {data.top_users.length ? (
                      data.top_users.map((item) => (
                        <div className="analytics-row" key={item.name}>
                          <span>{item.name}</span>
                          <b>{item.requests} requests</b>
                        </div>
                      ))
                    ) : (
                      <p className="context-empty">
                        No AI activity recorded yet.
                      </p>
                    )}
                  </section>
                  <section className="create-panel analytics-panel">
                    <div className="content-heading">
                      <div>
                        <h2>Knowledge base usage</h2>
                        <p>Documents per collection</p>
                      </div>
                    </div>
                    {data.knowledge_bases.length ? (
                      data.knowledge_bases.map((item) => (
                        <div className="analytics-row" key={item.name}>
                          <span>{item.name}</span>
                          <b>{item.documents} docs</b>
                        </div>
                      ))
                    ) : (
                      <p className="context-empty">
                        No knowledge bases available.
                      </p>
                    )}
                  </section>
                </div>
              </>
            )
          )}
        </div>
      </section>
    </main>
  );
}
