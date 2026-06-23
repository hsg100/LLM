"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { apiGet, Landscape } from "../../lib/api";
import { readLastLandscape, rememberLandscape } from "../../lib/landscape/recent";
import { FieldMapLogo } from "./Logo";

/**
 * Two-scope navigation.
 *
 *  • GLOBAL items (All landscapes / New landscape / Settings / Design system)
 *    always work and never depend on a landscape.
 *  • LANDSCAPE items (Overview … Export) act on the *current landscape*. The
 *    current landscape is resolved from the URL, falling back to the
 *    last-visited one (so the scoped nav keeps working when you step out to a
 *    global page). When no landscape has ever been opened, the scoped items
 *    render locked so it's obvious they need a landscape first.
 *
 * A context card at the top always shows which landscape (if any) the scoped
 * section targets, with an explicit way back to "all landscapes".
 */
type Item = {
  suffix: string;
  label: string;
  icon: ReactNode;
  isActive: (p: string, id: string) => boolean;
};

function landscapeIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/landscape\/([^/]+)/);
  return m ? m[1] : null;
}

const SCOPED_ITEMS: Item[] = [
  { suffix: "", label: "Overview", icon: <IconGrid />, isActive: (p, id) => p === `/landscape/${id}` || p === `/landscape/${id}/` },
  { suffix: "/map", label: "Field map", icon: <IconCluster />, isActive: (p, id) => p.startsWith(`/landscape/${id}/map`) },
  { suffix: "/papers", label: "Papers", icon: <IconList />, isActive: (p, id) => p.startsWith(`/landscape/${id}/papers`) || p.startsWith("/paper/") },
  { suffix: "/reading-plan", label: "Reading plan", icon: <IconPlan />, isActive: (p, id) => p.startsWith(`/landscape/${id}/reading-plan`) },
  { suffix: "/quiz", label: "Quiz", icon: <IconQuiz />, isActive: (p, id) => p.startsWith(`/landscape/${id}/quiz`) },
  { suffix: "/flashcards", label: "Flashcards", icon: <IconCards />, isActive: (p, id) => p.startsWith(`/landscape/${id}/flashcards`) },
  { suffix: "/review", label: "Review", icon: <IconReview />, isActive: (p, id) => p.startsWith(`/landscape/${id}/review`) },
  { suffix: "/export", label: "Obsidian export", icon: <IconExport />, isActive: (p, id) => p.startsWith(`/landscape/${id}/export`) },
];

const GLOBAL_ITEMS: { href: string; label: string; icon: ReactNode; isActive: (p: string) => boolean }[] = [
  { href: "/landscapes", label: "All landscapes", icon: <IconStack />, isActive: (p) => p === "/landscapes" },
  { href: "/search", label: "New landscape", icon: <IconSearch />, isActive: (p) => p.startsWith("/search") },
  { href: "/jobs", label: "Job monitor", icon: <IconJob />, isActive: (p) => p === "/jobs" || p.startsWith("/jobs/") },
  { href: "/settings", label: "Settings", icon: <IconGear />, isActive: (p) => p.startsWith("/settings") },
];

export function Sidebar() {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams();
  const fromPath = landscapeIdFromPath(pathname) || search?.get("landscape") || null;
  const [recentId, setRecentId] = useState<string | null>(null);

  // Keep the "last landscape" memory in sync with the route.
  useEffect(() => {
    if (fromPath) rememberLandscape(fromPath);
    setRecentId(readLastLandscape());
  }, [fromPath]);

  const landscapeId = fromPath ?? recentId;
  const inLandscape = !!fromPath; // truly viewing this landscape vs. just remembering it

  // Resolve the landscape's name + status for the context card.
  const [info, setInfo] = useState<{ id: string; topic: string; status: string } | null>(null);
  useEffect(() => {
    if (!landscapeId) {
      setInfo(null);
      return;
    }
    if (info?.id === landscapeId) return; // already loaded
    let cancelled = false;
    apiGet<Landscape>(`/api/landscapes/${landscapeId}`)
      .then((l) => !cancelled && setInfo({ id: l.id, topic: l.topic, status: l.status }))
      .catch(() => !cancelled && setInfo(null));
    return () => {
      cancelled = true;
    };
  }, [landscapeId, info?.id]);

  const topic = info?.id === landscapeId ? info?.topic : null;
  const status = info?.id === landscapeId ? info?.status : null;

  const scoped = useMemo(
    () =>
      SCOPED_ITEMS.map((it) => ({
        ...it,
        href: landscapeId ? `/landscape/${landscapeId}${it.suffix}` : null,
        active: !!landscapeId && inLandscape && it.isActive(pathname, landscapeId),
      })),
    [landscapeId, inLandscape, pathname]
  );

  return (
    <aside
      className="hidden md:flex"
      style={{
        background: "var(--sidebar)",
        borderRight: "1px solid var(--bd)",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Link
        href="/landscapes"
        style={{
          all: "unset",
          cursor: "pointer",
          padding: "20px 18px 16px",
          display: "flex",
          alignItems: "center",
          gap: 11,
          borderBottom: "1px solid var(--bd2)",
        }}
      >
        <FieldMapLogo size={28} />
        <div style={{ lineHeight: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.02em" }}>FieldMap</div>
          <div className="font-mono" style={{ fontSize: 9, color: "var(--t4)", letterSpacing: "0.14em", marginTop: 3 }}>
            RESEARCH OS
          </div>
        </div>
      </Link>

      <div
        style={{
          padding: "14px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 3,
          overflowY: "auto",
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* ---- GLOBAL ---- */}
        <SectionTitle>WORKSPACE</SectionTitle>
        {GLOBAL_ITEMS.map((it) => (
          <NavRow key={it.href} href={it.href} icon={it.icon} label={it.label} active={it.isActive(pathname)} />
        ))}

        {/* ---- LANDSCAPE CONTEXT CARD ---- */}
        <ContextCard landscapeId={landscapeId} topic={topic} status={status} inLandscape={inLandscape} />

        {/* ---- SCOPED ---- */}
        {scoped.map((it) =>
          it.href ? (
            <NavRow key={it.suffix} href={it.href} icon={it.icon} label={it.label} active={it.active} />
          ) : (
            <LockedRow key={it.suffix} icon={it.icon} label={it.label} />
          )
        )}
      </div>

      {process.env.NODE_ENV !== "production" && (
        <NavRow
          href="/design-system"
          icon={<span style={{ width: 9, height: 9, borderRadius: 3, background: "linear-gradient(135deg,#e0613a,#5b8def)" }} />}
          label="Design system"
          active={pathname.startsWith("/design-system")}
          framed
        />
      )}
    </aside>
  );
}

function ContextCard({
  landscapeId,
  topic,
  status,
  inLandscape,
}: {
  landscapeId: string | null;
  topic: string | null;
  status: string | null;
  inLandscape: boolean;
}) {
  if (!landscapeId) {
    return (
      <div style={{ margin: "14px 2px 4px" }}>
        <SectionTitle>CURRENT LANDSCAPE</SectionTitle>
        <div
          style={{
            margin: "2px 9px 0",
            padding: "10px 12px",
            borderRadius: 9,
            border: "1px dashed var(--bd)",
            color: "var(--t3)",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          No landscape selected.{" "}
          <Link href="/landscapes" style={{ color: "var(--accent-ink)", fontWeight: 600 }}>
            Browse →
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div style={{ margin: "16px 2px 4px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 11px 6px", gap: 8 }}>
        <span className="font-mono" style={{ fontSize: 9, color: "var(--t4)", letterSpacing: "0.16em" }}>
          {inLandscape ? "CURRENT LANDSCAPE" : "RECENT LANDSCAPE"}
        </span>
        <Link
          href="/landscapes"
          title="Back to all landscapes"
          style={{ fontSize: 10.5, color: "var(--t4)", textDecoration: "none", whiteSpace: "nowrap" }}
        >
          {inLandscape ? "✕ exit" : "switch"}
        </Link>
      </div>
      <Link
        href={`/landscape/${landscapeId}`}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "block",
          margin: "0 9px",
          padding: "9px 11px",
          borderRadius: 9,
          background: "var(--sidebar-item)",
          border: "1px solid var(--bd2)",
        }}
      >
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--t1)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {topic ?? "Loading…"}
        </div>
        {status && (
          <div className="font-mono" style={{ fontSize: 9.5, color: "var(--t4)", letterSpacing: "0.06em", marginTop: 3, textTransform: "uppercase" }}>
            {inLandscape ? status : `resume · ${status}`}
          </div>
        )}
      </Link>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono" style={{ fontSize: 9, color: "var(--t4)", letterSpacing: "0.16em", padding: "10px 10px 6px" }}>
      {children}
    </div>
  );
}

function NavRow({
  href,
  icon,
  label,
  active,
  framed,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  active: boolean;
  framed?: boolean;
}) {
  return (
    <Link
      href={href}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "9px 11px",
        margin: framed ? "8px 12px 14px" : undefined,
        borderRadius: 9,
        border: framed ? "1px solid var(--bd)" : undefined,
        fontSize: 13,
        background: active ? "var(--sidebar-item)" : "transparent",
        color: active ? "var(--t1)" : "var(--t2)",
        boxShadow: !framed && active ? "inset 2px 0 0 var(--accent)" : "inset 2px 0 0 transparent",
      }}
    >
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
    </Link>
  );
}

function LockedRow({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div
      title="Select a landscape first"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "9px 11px",
        borderRadius: 9,
        fontSize: 13,
        color: "var(--t4)",
        opacity: 0.55,
        cursor: "not-allowed",
      }}
    >
      <span style={{ display: "inline-flex" }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      <IconLock />
    </div>
  );
}

/* ---------- icons (single-stroke, inherit currentColor) ---------- */
function IconStack() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M7.5 1.5l6 3-6 3-6-3 6-3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M1.5 8l6 3 6-3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" opacity=".7" />
    </svg>
  );
}
function IconGrid() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1.3" stroke="currentColor" strokeWidth="1.3" />
      <rect x="8.5" y="1.5" width="5" height="5" rx="1.3" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.5" y="8.5" width="5" height="5" rx="1.3" stroke="currentColor" strokeWidth="1.3" />
      <rect x="8.5" y="8.5" width="5" height="5" rx="1.3" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
function IconCluster() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="3.3" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11.5" cy="3" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="9" cy="11.5" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 5 L9.5 10 M5 4 L10 3.3" stroke="currentColor" strokeWidth="1.2" opacity=".7" />
    </svg>
  );
}
function IconList() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M2 3.2h11M2 7.5h11M2 11.8h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function IconPlan() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="3" cy="3.5" r="1.4" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="3" cy="11" r="1.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3 5v4M6.5 3.5h6M6.5 11h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function IconQuiz() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.8 5.7a1.8 1.8 0 113 1.5c-.7.5-1.3.8-1.3 1.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="7.5" cy="11" r=".7" fill="currentColor" />
    </svg>
  );
}
function IconCards() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <rect x="2.5" y="3.5" width="10" height="8" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.5 7.5h10" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
function IconReview() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M12.5 7.5a5 5 0 11-1.6-3.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M12.7 1.8v2.6h-2.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="6.5" cy="6.5" r="4.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9.8 9.8L13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function IconJob() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 2.4" />
      <circle cx="7.5" cy="7.5" r="2" fill="currentColor" />
    </svg>
  );
}
function IconExport() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M7.5 1.8v7m0 0L5 6.3m2.5 2.5L10 6.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 9.8v1.8a1.4 1.4 0 001.4 1.4h7.2a1.4 1.4 0 001.4-1.4V9.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function IconGear() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="7.5" cy="7.5" r="2.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M7.5 1.5v1.6M7.5 11.9v1.6M1.5 7.5h1.6M11.9 7.5h1.6M3.3 3.3l1.1 1.1M10.6 10.6l1.1 1.1M11.7 3.3l-1.1 1.1M4.4 10.6l-1.1 1.1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconLock() {
  return (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="none" aria-hidden>
      <rect x="3" y="6.5" width="9" height="6.5" rx="1.3" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 6.5V5a2.5 2.5 0 015 0v1.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
