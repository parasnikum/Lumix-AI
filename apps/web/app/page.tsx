"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "./components/Brand";
import { CurrentUser, getAuthenticatedDestination, getCurrentUser } from "./lib/auth";

const capabilities = [
  { number: "01", title: "Your knowledge, connected", description: "Bring documents and internal resources into organized, searchable knowledge bases." },
  { number: "02", title: "Answers with evidence", description: "Ask questions in natural language and trace useful answers back to their source material." },
  { number: "03", title: "A workspace for teams", description: "Keep knowledge organized with workspace access, roles and a clear activity history." },
];

export default function Home() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null | false>(null);

  useEffect(() => {
    let active = true;
    getCurrentUser().then((user) => {
      if (active) setCurrentUser(user ?? false);
    }).catch(() => {
      if (active) setCurrentUser(false);
    });
    return () => { active = false; };
  }, []);

  const destination = currentUser
    ? getAuthenticatedDestination(currentUser)
    : "/login";

  return (
    <main className="marketing-page">
      <header className="marketing-nav">
        <Brand href="/" />
        <nav aria-label="Main navigation">
          <a href="#product">Product</a>
          <a href="#how-it-works">How it works</a>
          <a href="#teams">For teams</a>
        </nav>
        <div className="marketing-nav-actions">
          {currentUser ? (
            <Link href={destination} className="marketing-nav-cta">Open dashboard <span>↗</span></Link>
          ) : currentUser === false ? (
            <><Link href="/login" className="marketing-login">Log in</Link><Link href="/register" className="marketing-nav-cta">Get started <span>↗</span></Link></>
          ) : null}
        </div>
      </header>

      <section className="marketing-hero" id="product">
        <div className="marketing-hero-copy">
          <div className="marketing-eyebrow"><span /> PRIVATE AI KNOWLEDGE WORKSPACE</div>
          <h1>Your team's knowledge.<br /><em>Finally in conversation.</em></h1>
          <p>Make the information you already have easier to find, understand and put to work. Lumix brings your documents into one thoughtful AI workspace.</p>
          <div className="marketing-hero-actions">
            {currentUser ? (
              <Link href={destination} className="marketing-primary-cta">Go to dashboard <span>↗</span></Link>
            ) : currentUser === false ? (
              <><Link href="/register" className="marketing-primary-cta">Start with Lumix <span>↗</span></Link><Link href="/login" className="marketing-secondary-cta">Sign in to workspace</Link></>
            ) : null}
          </div>
          <div className="marketing-trust-line"><span className="marketing-trust-dot" /> Private by design <i /> Grounded in your sources <i /> Built for teams</div>
        </div>

        <div className="marketing-product-frame" aria-label="Lumix product preview">
          <div className="marketing-window-bar">
            <div className="marketing-window-dots"><i /><i /><i /></div>
            <div className="marketing-window-address">workspace.lumix.app</div>
            <span className="marketing-window-status">● Connected</span>
          </div>
          <div className="marketing-product-ui">
            <aside className="marketing-preview-sidebar">
              <div className="marketing-preview-brand"><Brand compact href="/" /></div>
              <div className="marketing-preview-active">◌ <span>AI conversations</span></div>
              <div>▤ <span>Knowledge bases</span></div>
              <div>⌘ <span>Team members</span></div>
              <div className="marketing-preview-label">YOUR WORKSPACE</div>
              <div className="marketing-preview-file">▧ <span>Product handbook</span></div>
              <div className="marketing-preview-file">▧ <span>Engineering notes</span></div>
              <div className="marketing-preview-file">▧ <span>Company policies</span></div>
            </aside>
            <div className="marketing-preview-main">
              <div className="marketing-preview-top"><span><b /> Lumix Assistant</span><small>Knowledge workspace　⌄</small></div>
              <div className="marketing-preview-content">
                <div className="marketing-preview-mark"><Brand compact href="/" /></div>
                <small className="marketing-preview-kicker">YOUR KNOWLEDGE, IN CONVERSATION</small>
                <h2>What can I help you<br /><em>discover today?</em></h2>
                <p>Explore your team's knowledge and get clear answers grounded in your own sources.</p>
                <div className="marketing-preview-cards">
                  <div><b>▤</b><strong>Knowledge-aware</strong><small>Answers from your sources</small></div>
                  <div><b>✳</b><strong>Context that connects</strong><small>Across selected collections</small></div>
                  <div><b>▢</b><strong>Built for teams</strong><small>Private by design</small></div>
                </div>
                <div className="marketing-preview-input">Ask a question about your knowledge… <span>↑</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-proof-strip" id="teams">
        <span>LESS SEARCHING</span><i /><span>MORE SHARED CONTEXT</span><i /><span>ANSWERS YOU CAN TRACE</span>
      </section>

      <section className="marketing-capabilities" id="how-it-works">
        <div className="marketing-section-heading">
          <div className="marketing-eyebrow">A CLEARER WAY TO WORK WITH INFORMATION</div>
          <h2>From scattered files<br /><em>to shared understanding.</em></h2>
          <p>Lumix gives your team's existing knowledge a place to become useful every day.</p>
        </div>
        <div className="marketing-workflow" aria-label="Lumix workflow">
          <div className="marketing-workflow-track" aria-hidden="true"><span /></div>
          {[
            { number: "01", title: "Bring it in", detail: "Upload your team documents", icon: "↥" },
            { number: "02", title: "Make it searchable", detail: "Lumix organizes the context", icon: "⌕" },
            { number: "03", title: "Ask naturally", detail: "Ask questions in plain language", icon: "?" },
            { number: "04", title: "Get grounded answers", detail: "Review answers with sources", icon: "✓" },
          ].map((step) => (
            <article className="marketing-workflow-step" key={step.number}>
              <div className="marketing-workflow-node">{step.icon}</div>
              <span>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
        <div className="marketing-capability-grid">
          {capabilities.map((item) => (
            <article key={item.number}>
              <span>{item.number}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-bottom-cta">
        <div>
          <div className="marketing-eyebrow">MAKE YOUR KNOWLEDGE WORK HARDER</div>
          <h2>Good answers start<br /><em>with what you know.</em></h2>
        </div>
        {currentUser ? (
          <Link href={destination} className="marketing-primary-cta">Open dashboard <span>↗</span></Link>
        ) : currentUser === false ? (
          <Link href="/register" className="marketing-primary-cta">Create your workspace <span>↗</span></Link>
        ) : null}
      </section>

      <footer className="marketing-footer">
        <Brand href="/" />
        <span>Private knowledge. Clear answers.</span>
        <div>{currentUser ? <Link href={destination}>Dashboard</Link> : currentUser === false ? <><Link href="/login">Log in</Link><Link href="/register">Get started</Link></> : null}</div>
        <small>© {new Date().getFullYear()} Lumix</small>
      </footer>
    </main>
  );
}
