"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { readLastLandscape, rememberLandscape } from "../../lib/landscape/recent";

type Tab = {
  key: string;
  label: string;
  href: string;
  icon: JSX.Element;
  active: boolean;
  locked?: boolean;
};

function landscapeIdFromPath(p: string): string | null {
  const m = p.match(/^\/landscape\/([^/]+)/);
  return m ? m[1] : null;
}

/**
 * Mobile bottom navigation, context-dependent:
 *
 *  • Product mode (default): Home / Learn / Research / Review / Search —
 *    the product-level surfaces. None of these need a landscape.
 *  • Landscape mode (inside /landscape/* or /paper/*): the existing scoped
 *    tabs (Overview / Read / Learn / Map) are preserved, with Home returning
 *    to the product home. Scoped tabs lock when no landscape can be resolved
 *    (mirrors the desktop sidebar's locked rows).
 */
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

  const inResearchContext = !!fromPath || pathname.startsWith("/paper/");
  const landscapeId = fromPath ?? fallbackId;

  const tabs: Tab[] = inResearchContext
    ? landscapeTabs(pathname, landscapeId)
    : productTabs(pathname);

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
          aria-disabled={t.locked}
          title={t.locked ? "Select a landscape first" : undefined}
          style={{
            all: "unset",
            cursor: "pointer",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            position: "relative",
            color: t.active ? "var(--accent-ink)" : "var(--t3)",
            opacity: t.locked ? 0.4 : 1,
            minHeight: 44,
            padding: "4px 0",
          }}
        >
          {t.icon}
          <span style={{ fontSize: 9.5, fontWeight: t.active ? 600 : 400 }}>{t.label}</span>
          {t.locked && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: 2,
                right: "calc(50% - 16px)",
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--t4)",
              }}
            />
          )}
        </Link>
      ))}
    </nav>
  );
}

function productTabs(pathname: string): Tab[] {
  return [
    { key: "home", label: "Home", href: "/", icon: <IconHome />, active: pathname === "/" },
    { key: "learn", label: "Learn", href: "/learn", icon: <IconLearn />, active: pathname.startsWith("/learn") },
    {
      key: "research",
      label: "Research",
      href: "/landscapes",
      icon: <IconResearch />,
      active: pathname === "/landscapes" || pathname.startsWith("/jobs"),
    },
    { key: "review", label: "Review", href: "/review", icon: <IconReview />, active: pathname.startsWith("/review") },
    { key: "search", label: "Search", href: "/search", icon: <IconSearch />, active: pathname.startsWith("/search") },
  ];
}

function landscapeTabs(pathname: string, landscapeId: string | null): Tab[] {
  const locked = !landscapeId;
  const lp = (suffix: string) => (landscapeId ? `/landscape/${landscapeId}${suffix}` : "/landscapes");
  return [
    { key: "home", label: "Home", href: "/", icon: <IconHome />, active: false },
    {
      key: "overview",
      label: "Overview",
      href: lp(""),
      icon: <IconResearch />,
      locked,
      active: !locked && pathname === `/landscape/${landscapeId}`,
    },
    {
      key: "read",
      label: "Read",
      href: lp("/reading-plan"),
      icon: <IconRead />,
      locked,
      active:
        !locked &&
        (pathname.includes("/reading-plan") || pathname.startsWith("/paper/") || pathname.includes("/papers")),
    },
    {
      key: "learn",
      label: "Learn",
      href: lp("/quiz"),
      icon: <IconLearn />,
      locked,
      active:
        !locked &&
        (pathname.includes("/quiz") || pathname.includes("/flashcards") || pathname.includes("/review")),
    },
    {
      key: "map",
      label: "Map",
      href: lp("/map"),
      icon: <IconMap />,
      locked,
      active: !locked && pathname.endsWith("/map"),
    },
  ];
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
      <path
        d="M7.5 3.2c-1.3-1-3-1.4-5-1.2v9.6c2-.2 3.7.2 5 1.2 1.3-1 3-1.4 5-1.2V2c-2-.2-3.7.2-5 1.2z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M7.5 3.2v9.6" stroke="currentColor" strokeWidth="1.3" opacity=".7" />
    </svg>
  );
}
function IconResearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 15 15" fill="none">
      <path d="M7.5 1.5l6 3-6 3-6-3 6-3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M1.5 8l6 3 6-3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" opacity=".7" />
    </svg>
  );
}
function IconReview() {
  return (
    <svg width="20" height="20" viewBox="0 0 15 15" fill="none">
      <path d="M12.5 7.5a5 5 0 11-1.6-3.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M12.7 1.8v2.6h-2.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
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
