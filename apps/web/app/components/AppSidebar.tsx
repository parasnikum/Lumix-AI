"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Brand } from "./Brand";
import { useTheme } from "./ThemeProvider";

type Section = "dashboard" | "knowledge-bases" | "chat" | "team" | "providers" | "profile" | "analytics" | "audit";
type AppSidebarProps = { active: Section; tenantName?: string };

const workspaceLinks = [
  { href: "/dashboard", label: "Overview", icon: "⌂", key: "dashboard" },
  { href: "/knowledge-bases", label: "Knowledge bases", icon: "▤", key: "knowledge-bases" },
  { href: "/chat", label: "AI conversations", icon: "◌", key: "chat" },
  { href: "/team", label: "Team members", icon: "⌘", key: "team" },
] as const;
const configurationLinks = [
  { href: "/settings/providers", label: "AI providers", icon: "⌁", key: "providers" },
  { href: "/profile", label: "Profile & preferences", icon: "◎", key: "profile" },
  { href: "/analytics", label: "Usage analytics", icon: "◷", key: "analytics" },
  { href: "/audit", label: "Audit log", icon: "≡", key: "audit" },
] as const;

export default function AppSidebar({ active, tenantName = "Workspace" }: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setCollapsed(window.localStorage.getItem("lumix-sidebar") === "collapsed");
  }, []);

  function toggleSidebar() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("lumix-sidebar", next ? "collapsed" : "expanded");
      return next;
    });
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <aside className={`app-sidebar ${collapsed ? "app-sidebar-collapsed" : ""}`}>
      <div className="sidebar-brand-row">
        <Brand compact={collapsed} />
        <button className="sidebar-control" onClick={toggleSidebar} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? "»" : "«"}
        </button>
      </div>
      <Link href="/workspaces" className="workspace-chip" title={tenantName}>
        <span className="workspace-avatar">{tenantName[0] ?? "W"}</span>
        <span className="workspace-chip-copy"><b>{tenantName}</b><small>Switch workspace</small></span>
      </Link>
      <div className="nav-caption">WORKSPACE</div>
      <nav className="app-nav">
        {workspaceLinks.map((item) => <Link className={active === item.key ? "selected" : ""} href={item.href} key={item.key} title={collapsed ? item.label : undefined}><span>{item.icon}</span><span className="nav-link-label">{item.label}</span></Link>)}
      </nav>
      <div className="nav-caption nav-caption-spaced">CONFIGURATION</div>
      <nav className="app-nav">
        {configurationLinks.map((item) => <Link className={active === item.key ? "selected" : ""} href={item.href} key={item.key} title={collapsed ? item.label : undefined}><span>{item.icon}</span><span className="nav-link-label">{item.label}</span></Link>)}
      </nav>
      <div className="sidebar-footer">
        <button className="sidebar-theme-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}>
          <span>{theme === "light" ? "◐" : "☼"}</span><span className="nav-link-label">{theme === "light" ? "Dark appearance" : "Light appearance"}</span>
        </button>
        <Link href="/profile" className="sidebar-profile-link" title={collapsed ? "Profile" : undefined}><span className="profile-avatar">U</span><span className="sidebar-profile-copy"><b>My profile</b><small>Account settings</small></span></Link>
        <button className="sidebar-logout" onClick={signOut} disabled={signingOut} title={collapsed ? "Log out" : undefined}><span>↗</span><span className="nav-link-label">{signingOut ? "Signing out…" : "Log out"}</span></button>
      </div>
    </aside>
  );
}
