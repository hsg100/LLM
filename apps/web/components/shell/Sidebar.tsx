"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ReactNode, useMemo } from "react";
import { FieldMapLogo } from "./Logo";

/**
 * The sidebar groups routes into WORKSPACE / LEARN / PIPELINE / OUTPUT.
 * WORKSPACE/LEARN/OUTPUT links target the current landscape — if the URL
 * doesn't carry a landscape id we fall back to /landscapes so the user
 * picks one before drilling in.
 */
type Item = {
  href: string;
  label: string;
  icon: ReactNode;
  rightSlot?: ReactNode;
  match: (pathname: string) => boolean;
};

function landscapeIdFromPath(pathname: string): string | null {
  // /landscape/<id>/...  or  /paper/<id>  (paper has no landscape ctx)
  const m = pathname.match(/^\/landscape\/([^/]+)/);
  return m ? m[1] : null;
}

export function Sidebar() {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams();
  const landscapeFromQuery = search?.get("landscape");
  const landscapeId =
    landscapeIdFromPath(pathname) || landscapeFromQuery || null;

  const lp = (suffix: string) =>
    landscapeId ? `/landscape/${landscapeId}${suffix}` : "/landscapes";

  const groups: { title: string; items: Item[] }[] = useMemo(
    () => [
      {
        title: "WORKSPACE",
        items: [
          {
            href: lp(""),
            label: "Overview",
            icon: <IconGrid />,
            match: (p) =>
              !!landscapeId &&
              (p === `/landscape/${landscapeId}` || p === `/landscape/${landscapeId}/`),
          },
          {
            href: lp("/map"),
            label: "Cluster map",
            icon: <IconCluster />,
            match: (p) => !!landscapeId && p.startsWith(`/landscape/${landscapeId}/map`),
          },
          {
            href: lp("/papers"),
            label: "Papers",
            icon: <IconList />,
            match: (p) =>
              (!!landscapeId && p.startsWith(`/landscape/${landscapeId}/papers`)) ||
              p.startsWith("/paper/"),
          },
          {
            href: lp("/reading-plan"),
            label: "Reading plan",
            icon: <IconPlan />,
            match: (p) => !!landscapeId && p.startsWith(`/landscape/${landscapeId}/reading-plan`),
          },
        ],
      },
      {
        title: "LEARN",
        items: [
          {
            href: lp("/quiz"),
            label: "Quiz",
            icon: <IconQuiz />,
            match: (p) => !!landscapeId && p.startsWith(`/landscape/${landscapeId}/quiz`),
          },
          {
            href: lp("/flashcards"),
            label: "Flashcards",
            icon: <IconCards />,
            match: (p) => !!landscapeId && p.startsWith(`/landscape/${landscapeId}/flashcards`),
          },
        ],
      },
      {
        title: "PIPELINE",
        items: [
          {
            href: "/search",
            label: "New landscape",
            icon: <IconSearch />,
            match: (p) => p.startsWith("/search"),
          },
          {
            href: "/landscapes",
            label: "Job monitor",
            icon: <IconJob />,
            match: (p) => p.startsWith("/jobs") || p === "/landscapes",
          },
        ],
      },
      {
        title: "OUTPUT",
        items: [
          {
            href: lp("/export"),
            label: "Obsidian export",
            icon: <IconExport />,
            match: (p) => !!landscapeId && p.startsWith(`/landscape/${landscapeId}/export`),
          },
          {
            href: "/settings",
            label: "Settings",
            icon: <IconGear />,
            match: (p) => p.startsWith("/settings"),
          },
        ],
      },
    ],
    [landscapeId, pathname]
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
      <div
        style={{
          padding: "20px 18px 16px",
          display: "flex",
          alignItems: "center",
          gap: 11,
          borderBottom: "1px solid var(--bd2)",
        }}
      >
        <FieldMapLogo size={28} />
        <div style={{ lineHeight: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.02em" }}>
            FieldMap
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: 9,
              color: "var(--t4)",
              letterSpacing: "0.14em",
              marginTop: 3,
            }}
          >
            RESEARCH OS
          </div>
        </div>
      </div>

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
        {landscapeId && (
          <Link
            href="/landscapes"
            style={{
              all: "unset",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 10px",
              borderRadius: 8,
              color: "var(--t3)",
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 16 }}>←</span> All landscapes
          </Link>
        )}
        {groups.map((g) => (
          <div key={g.title}>
            <div
              className="font-mono"
              style={{
                fontSize: 9,
                color: "var(--t4)",
                letterSpacing: "0.16em",
                padding: "10px 10px 6px",
              }}
            >
              {g.title}
            </div>
            {g.items.map((it) => (
              <NavLink key={it.href + it.label} item={it} pathname={pathname} />
            ))}
          </div>
        ))}
      </div>

      <Link
        href="/design-system"
        style={{
          all: "unset",
          cursor: "pointer",
          margin: "8px 12px 14px",
          padding: "11px 13px",
          borderRadius: 9,
          border: "1px solid var(--bd)",
          display: "flex",
          alignItems: "center",
          gap: 9,
          fontSize: 12,
          color: pathname.startsWith("/design-system") ? "var(--t1)" : "var(--t2)",
          background: pathname.startsWith("/design-system")
            ? "var(--sidebar-item)"
            : "transparent",
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: 3,
            background: "linear-gradient(135deg,#e0613a,#5b8def)",
          }}
        />
        Design system
      </Link>
    </aside>
  );
}

function NavLink({ item, pathname }: { item: Item; pathname: string }) {
  const active = item.match(pathname);
  return (
    <Link
      href={item.href}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "9px 11px",
        borderRadius: 9,
        fontSize: 13,
        background: active ? "var(--sidebar-item)" : "transparent",
        color: active ? "var(--t1)" : "var(--t2)",
        boxShadow: active ? "inset 2px 0 0 var(--accent)" : "inset 2px 0 0 transparent",
      }}
    >
      {item.icon}
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.rightSlot}
    </Link>
  );
}

/* ---------- icons (single-stroke, inherit currentColor) ---------- */
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
      <path
        d="M2 3.2h11M2 7.5h11M2 11.8h7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconPlan() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="3" cy="3.5" r="1.4" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="3" cy="11" r="1.4" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M3 5v4M6.5 3.5h6M6.5 11h6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconQuiz() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M5.8 5.7a1.8 1.8 0 113 1.5c-.7.5-1.3.8-1.3 1.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
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
      <circle
        cx="7.5"
        cy="7.5"
        r="6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeDasharray="3 2.4"
      />
      <circle cx="7.5" cy="7.5" r="2" fill="currentColor" />
    </svg>
  );
}
function IconExport() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path
        d="M7.5 1.8v7m0 0L5 6.3m2.5 2.5L10 6.3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.5 9.8v1.8a1.4 1.4 0 001.4 1.4h7.2a1.4 1.4 0 001.4-1.4V9.8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
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
