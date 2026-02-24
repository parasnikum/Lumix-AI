"use client";

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../lib/api";
import { Brand } from "../components/Brand";

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <main className="auth-page">
          <section className="auth-card">Loading invitation…</section>
        </main>
      }
    >
      <InviteContent />
    </Suspense>
  );
}

function InviteContent() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api("/auth/accept-invitation", {
        method: "POST",
        body: JSON.stringify({ token, full_name: name, password }),
      });
      window.location.assign("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to accept invitation");
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-card">
        <Brand href="/" />
        <div className="eyebrow">ORGANIZATION INVITATION</div>
        <h1>Join your team.</h1>
        <p className="auth-subtitle">
          Set up your account to access the shared knowledge workspace.
        </p>
        {!token ? (
          <p className="form-error">
            This invitation link is missing its token.
          </p>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <label>
              Your name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                required
              />
            </label>
            <label>
              Create password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={10}
                required
              />
              <small>
                At least 10 characters. If you already have a Lumix account, use
                your existing password.
              </small>
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="primary-button auth-submit" disabled={loading}>
              {loading ? "Joining…" : "Accept invitation"} <span>→</span>
            </button>
          </form>
        )}
      </section>
      <aside className="auth-aside">
        <img className="auth-aside-mark" src="/logo.svg" alt="Lumix" />
        <p>
          Shared knowledge.
          <br />
          <em>Clear permissions.</em>
        </p>
        <span>
          Your organization controls which knowledge bases you can access.
        </span>
      </aside>
    </main>
  );
}
