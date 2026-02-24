"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";
import { getAuthenticatedDestination, getCurrentUser } from "../lib/auth";
import { Brand } from "../components/Brand";

export default function LoginPage() {
  const [checkingSession, setCheckingSession] = useState(true);
  useEffect(() => {
    let active = true;
    getCurrentUser().then((user) => {
      if (!active) return;
      if (user) window.location.replace(getAuthenticatedDestination(user));
      else setCheckingSession(false);
    }).catch(() => { if (active) setCheckingSession(false); });
    return () => { active = false; };
  }, []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await api<{ user: { is_super_admin: boolean } }>(
        "/auth/login",
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      window.location.assign(
        result.user.is_super_admin ? "/platform" : "/dashboard",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally {
      setLoading(false);
    }
  }

  if (checkingSession) {
    return <main className="auth-page"><section className="auth-card"><Brand href="/" /><p className="auth-subtitle">Checking your session…</p></section></main>;
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Brand href="/" />
        <div className="eyebrow">YOUR KNOWLEDGE WORKSPACE</div>
        <h1>Welcome back.</h1>
        <p className="auth-subtitle">
          Sign in to continue to your organization's knowledge.
        </p>
        <form onSubmit={submit} className="auth-form">
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button auth-submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"} <span>→</span>
          </button>
        </form>
        <p className="auth-switch">
          New to Lumix? <Link href="/register">Create an account</Link>
        </p>
      </section>
      <aside className="auth-aside">
        <img className="auth-aside-mark" src="/logo.svg" alt="Lumix" />
        <p>
          Private knowledge.
          <br />
          <em>Clear answers.</em>
        </p>
        <span>
          Bring your team's information together, with every answer grounded in
          its source.
        </span>
      </aside>
    </main>
  );
}
