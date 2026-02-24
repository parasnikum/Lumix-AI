"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";
import { getAuthenticatedDestination, getCurrentUser } from "../lib/auth";
import { Brand } from "../components/Brand";

export default function RegisterPage() {
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

  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          full_name: name,
          organization_name: organization,
          email,
          password,
        }),
      });
      window.location.assign("/dashboard");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to create your account",
      );
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
        <div className="eyebrow">START YOUR WORKSPACE</div>
        <h1>Make knowledge useful.</h1>
        <p className="auth-subtitle">
          Create your account and organization to get started.
        </p>
        <form onSubmit={submit} className="auth-form">
          <label>
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              minLength={2}
              required
            />
          </label>
          <label>
            Organization name
            <input
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              minLength={2}
              required
            />
          </label>
          <label>
            Work email
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
              autoComplete="new-password"
              minLength={10}
              required
            />
            <small>Use at least 10 characters.</small>
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button auth-submit" disabled={loading}>
            {loading ? "Creating workspace…" : "Create workspace"}{" "}
            <span>→</span>
          </button>
        </form>
        <p className="auth-switch">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </section>
      <aside className="auth-aside">
        <img className="auth-aside-mark" src="/logo.svg" alt="Lumix" />
        <p>
          One workspace.
          <br />
          <em>Knowledge in context.</em>
        </p>
        <span>
          Securely organize documents and give your team an assistant that can
          cite its sources.
        </span>
      </aside>
    </main>
  );
}
