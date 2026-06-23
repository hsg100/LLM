"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { useTheme } from "../../app/providers";
import { apiGet, Landscape } from "../../lib/api";

/**
 * Topbar shows a breadcrumb derived from the current route plus the
 * landscape topic when applicable, a (visual) ⌘K search field, a theme
 * toggle, and a primary Export CTA that links to the active landscape's
 * export screen.
 */
export function Topbar() {
  const pathname = usePathname() ?? "/";
  const { theme, toggle } = useTheme();
  const [topic, setTopic] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const landscapeId = (() => {
    const m = pathname.match(/^\/landscape\/([^/]+)/);
    return m ? m[1] : null;
  })();

  useEffect(() => {
    if (!landscapeId) {
      setTopic(null);
      setStatus(null);
      return;
    }
    let cancelled = false;
    apiGet<Landscape>(`/api/landscapes/${landscapeId}`)
      .then((l) => {
        if (!cancelled) {
          setTopic(l.topic);
          setStatus(l.status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTopic(null);
          setStatus(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [landscapeId]);

  const crumb = (() => {
    if (pathname === "/search" || pathname.startsWith("/search"))
      return { left: "pipeline /", leftHref: "/landscapes", right: "New landscape", rightHref: null as string | null };
    if (pathname.startsWith("/jobs/"))
      return { left: "pipeline /", leftHref: "/landscapes", right: "Job monitor", rightHref: null as string | null };
    if (pathname === "/landscapes")
      return { left: "workspace /", leftHref: "/", right: "Landscapes", rightHref: null as string | null };
    if (pathname.startsWith("/settings"))
      return { left: "output /", leftHref: "/landscapes", right: "Settings & readiness", rightHref: null as string | null };
    if (pathname.startsWith("/design-system"))
      return { left: "system /", leftHref: "/landscapes", right: "Design system", rightHref: null as string | null };
    if (pathname.startsWith("/paper/"))
      return { left: "landscapes /", leftHref: "/landscapes", right: "Paper detail", rightHref: null as string | null };
    if (landscapeId)
      return { left: "landscapes /", leftHref: "/landscapes", right: topic ?? "…", rightHref: `/landscape/${landscapeId}` };
    return { left: "fieldmap", leftHref: "/", right: "", rightHref: null as string | null };
  })();

  const exportHref = landscapeId ? `/landscape/${landscapeId}/export` : null;

  return (
    <header
      className="fm-topbar"
      style={{
        height: 58,
        flex: "none",
        borderBottom: "1px solid var(--bd)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 16px",
        background: "var(--topbar)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <Link
          href={crumb.leftHref}
          className="font-mono"
          style={{ fontSize: 11, color: "var(--t4)", textDecoration: "none" }}
        >
          {crumb.left}
        </Link>
        {crumb.rightHref ? (
          <Link
            href={crumb.rightHref}
            style={{
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 360,
              color: "inherit",
              textDecoration: "none",
            }}
          >
            {crumb.right}
          </Link>
        ) : (
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 360,
            }}
          >
            {crumb.right}
          </span>
        )}
        {landscapeId && status && <StatusPill status={status} />}
      </div>

      <div style={{ flex: 1 }} />

      {/* ⌘K search is desktop-only — phones get the system keyboard via the Search tab. */}
      <div className="hidden md:flex">
        <FakeSearch />
      </div>

      <button
        onClick={toggle}
        title="Toggle theme"
        style={topbarButtonStyle}
        aria-label="Toggle theme"
      >
        {theme === "dark" ? (
          <svg width="16" height="16" viewBox="0 0 15 15" fill="none">
            <circle cx="7.5" cy="7.5" r="3.2" stroke="currentColor" strokeWidth="1.3" />
            <path
              d="M7.5 1v1.6M7.5 12.4V14M1 7.5h1.6M12.4 7.5H14M3 3l1.1 1.1M10.9 10.9L12 12M12 3l-1.1 1.1M4.1 10.9L3 12"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path
              d="M12.5 8.6A5.2 5.2 0 016 2.1a5.3 5.3 0 100 10.7 5.2 5.2 0 006.5-4.2z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {/* The Export CTA in the topbar is desktop-only too — on mobile, Export
          lives behind a small icon when a landscape is in route. The big
          primary path is the bottom Learn / Read tabs. */}
      {exportHref && (
        <Link
          href={exportHref}
          className="hidden md:inline-flex"
          style={{
            alignItems: "center",
            gap: 8,
            padding: "9px 15px",
            borderRadius: 9,
            background: "var(--accent)",
            color: "#fff",
            fontSize: 12.5,
            fontWeight: 600,
            boxShadow: "0 2px 10px rgba(224,97,58,.28)",
            textDecoration: "none",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 15 15" fill="none">
            <path
              d="M7.5 1.8v7m0 0L5 6.3m2.5 2.5L10 6.3"
              stroke="#fff"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Export
        </Link>
      )}

      {/* Mobile: a small icon button preserves the export entry-point when
          we're inside a landscape, without crowding the bar. */}
      {landscapeId && exportHref && (
        <Link
          href={exportHref}
          className="md:hidden"
          style={{
            ...topbarButtonStyle,
            color: "var(--accent-ink)",
          }}
          aria-label="Export to Obsidian"
        >
          <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
            <path
              d="M7.5 9V2m0 7L5 6.5M7.5 9L10 6.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2.5 9.5v2A1.5 1.5 0 004 13h7a1.5 1.5 0 001.5-1.5v-2"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </Link>
      )}
    </header>
  );
}

const topbarButtonStyle = {
  all: "unset",
  cursor: "pointer",
  width: 38,
  height: 36,
  borderRadius: 9,
  border: "1px solid var(--bd)",
  background: "var(--panel)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--t2)",
} as const;

function StatusPill({ status }: { status: string }) {
  const ready = status === "ready" || status === "done";
  const running = status === "running" || status === "queued";
  const failed = status === "failed";
  const bg = ready ? "var(--good-bg)" : running ? "var(--accent-bg)" : "var(--good-bg)";
  const color = ready
    ? "var(--good)"
    : running
    ? "var(--accent-ink)"
    : failed
    ? "var(--bad)"
    : "var(--good)";
  return (
    <span
      className="fm-status-pill"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 999,
        background: bg,
        marginLeft: 4,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
        }}
      />
      <span
        className="font-mono"
        style={{
          fontSize: 10,
          color,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {status}
      </span>
    </span>
  );
}

function FakeSearch(): ReactNode {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("fm:open-cmdk"))}
      aria-label="Open command palette"
      style={{
        all: "unset",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "8px 12px",
        borderRadius: 9,
        border: "1px solid var(--bd)",
        background: "var(--panel)",
        color: "var(--t3)",
        fontSize: 12.5,
        width: 230,
        boxSizing: "border-box",
      }}
    >
      <svg width="13" height="13" viewBox="0 0 15 15" fill="none">
        <circle cx="6.5" cy="6.5" r="4.3" stroke="currentColor" strokeWidth="1.3" />
        <path d="M9.8 9.8L13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      <span>Search papers, concepts…</span>
      <span
        className="font-mono"
        style={{
          marginLeft: "auto",
          fontSize: 10,
          color: "var(--t4)",
          border: "1px solid var(--bd)",
          borderRadius: 4,
          padding: "1px 5px",
        }}
      >
        ⌘K
      </span>
    </button>
  );
}
