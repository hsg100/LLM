"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { readLastLandscape, rememberLandscape } from "../../lib/landscape/recent";

type TabKey = "home" | "read" | "learn" | "map" | "search";

function landscapeIdFromPath(p: string): string | null {
  const m = p.match(/^\/landscape\/([^/]+)/);
  return m ? m[1] : null;
}

export function BottomTabBar() {
  const pathname = usePathname() ?? "/";
  const fromPath = landscapeIdFromPath(pathname);
  const [fallbackId, setFallbackId] = useState<string | null>(null);

  // Remember the current landscape and read the fallback for tabs the
  // user can hit from any screen.
  useEffect(() => {
    if (fromPath) rememberLandscape(fromPath);
    setFallbackId(readLastLandscape());
  }, [fromPath]);

  const landscapeId = fromPath ?? fallbackId;
  const lp = (suffix: string) =>
    landscapeId ? `/landscape/${landscapeId}${suffix}` : "/landscapes";

  const tabs: { key: TabKey; label: string; href: string; icon: JSX.Element; active: boolean }[] = [
    {
      key: "home",
      label: "Home",
      href: lp(""),
      icon: <IconHome />,
      active:
        pathname === "/" ||
        pathname === lp("") ||
        (!!landscapeId && pathname === `/landscape/${landscapeId}`),
    },
    {
      key: "read",
      label: "Read",
      href: lp("/reading-plan"),
      icon: <IconRead />,
      active:
        pathname.includes("/reading-plan") ||
        pathname.startsWith("/paper/") ||
        pathname.includes("/papers"),
    },
    {
      key: "learn",
      label: "Learn",
      href: lp("/quiz"),
      icon: <IconLearn />,
      active: pathname.includes("/quiz") || pathname.includes("/flashcards"),
    },
    {
      key: "map",
      label: "Map",
      href: lp("/map"),
      icon: <IconMap />,
      active: pathname.endsWith("/map"),
    },
    {
      key: "search",
      label: "Search",
      href: "/search",
      icon: <IconSearch />,
      active: pathname.startsWith("/search") || pathname === "/landscapes",
    },
  ];

  return (
    <nav
      className="md:hidden"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        display: "flex",
        padding: "9px 12px calc(env(safe-area-inset-bottom, 14px) + 8px)",
        background: "var(--panel)",
        borderTop: "1px solid var(--bd)",
        backdropFilter: "blur(8px)",
      }}
    >
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          style={{
            all: "unset",
            cursor: "pointer",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            color: t.active ? "var(--accent-ink)" : "var(--t3)",
            minHeight: 44,
            padding: "4px 0",
          }}
        >
          {t.icon}
          <span style={{ fontSize: 9.5, fontWeight: t.active ? 600 : 400 }}>
            {t.label}
          </span>
        </Link>
      ))}
    </nav>
  );
}

function IconHome() {
  return (
    <svg width="20" height="20" viewBox="0 0 15 15" fill="none">
      <path
        d="M2 6.5L7.5 2l5.5 4.5V13a.5.5 0 01-.5.5H9V9.5H6v4H2.5A.5.5 0 012 13V6.5z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconRead() {
  return (
    <svg width="20" height="20" viewBox="0 0 15 15" fill="none">
      <path
        d="M2 3.5h11M2 7.5h11M2 11.5h7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconLearn() {
  return (
    <svg width="20" height="20" viewBox="0 0 15 15" fill="none">
      <rect x="2.5" y="3.5" width="10" height="8" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.5 7.5h10" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
function IconMap() {
  return (
    <svg width="20" height="20" viewBox="0 0 15 15" fill="none">
      <circle cx="3.3" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11.5" cy="3.5" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="9" cy="11.5" r="2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 15 15" fill="none">
      <circle cx="6.5" cy="6.5" r="4.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9.8 9.8L13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
