"use client";

import Link from "next/link";

export function Brand({
  compact = false,
  href = "/dashboard",
  className = "",
}: {
  compact?: boolean;
  href?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`lumix-brand ${compact ? "lumix-brand-compact" : ""} ${className}`}
      aria-label="Lumix home"
    >
      <img
        className="lumix-brand-symbol"
        src="/logo.svg"
        alt=""
        aria-hidden="true"
      />
      {!compact && (
        <span className="lumix-brand-word">
          lumix<span>.</span>
        </span>
      )}
    </Link>
  );
}
