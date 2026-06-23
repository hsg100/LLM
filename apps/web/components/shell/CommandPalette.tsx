"use client";

// ⌘K command palette: jump to any global page, landscape, or scoped page for the
// active landscape. Doubles as the landscape switcher. Opens on ⌘/Ctrl-K or when
// anything dispatches a `fm:open-cmdk` window event (the topbar search box does).

import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, Landscape } from "../../lib/api";
import { readLastLandscape } from "../../lib/landscape/recent";

type Cmd = { id: string; label: string; hint: string; href: string; group: string };

function landscapeIdFromPath(p: string): string | null {
  const m = p.match(/^\/landscape\/([^/]+)/);
  return m ? m[1] : null;
}

const SCOPED: { suffix: string; label: string }[] = [
  { suffix: "", label: "Overview" },
  { suffix: "/map", label: "Field map" },
  { suffix: "/papers", label: "Papers" },
  { suffix: "/reading-plan", label: "Reading plan" },
  { suffix: "/quiz", label: "Quiz" },
  { suffix: "/flashcards", label: "Flashcards" },
  { suffix: "/review", label: "Review" },
  { suffix: "/export", label: "Obsidian export" },
];

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [landscapes, setLandscapes] = useState<Landscape[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeLandscape = landscapeIdFromPath(pathname) ?? readLastLandscape();

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  }, []);

  // Global open triggers: ⌘/Ctrl-K and the custom event from the topbar.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        close();
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("fm:open-cmdk", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("fm:open-cmdk", onOpen);
    };
  }, [close]);

  // Load landscapes lazily the first time the palette opens.
  useEffect(() => {
    if (!open || landscapes.length) return;
    apiGet<Landscape[]>("/api/landscapes")
      .then(setLandscapes)
      .catch(() => setLandscapes([]));
  }, [open, landscapes.length]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const commands = useMemo<Cmd[]>(() => {
    const out: Cmd[] = [
      { id: "g-landscapes", label: "All landscapes", hint: "workspace", href: "/landscapes", group: "Go to" },
      { id: "g-new", label: "New landscape", hint: "pipeline", href: "/search", group: "Go to" },
      { id: "g-jobs", label: "Job monitor", hint: "pipeline", href: "/jobs", group: "Go to" },
      { id: "g-settings", label: "Settings", hint: "system", href: "/settings", group: "Go to" },
    ];
    if (activeLandscape) {
      for (const it of SCOPED) {
        out.push({
          id: `s-${it.suffix}`,
          label: it.label,
          hint: "current landscape",
          href: `/landscape/${activeLandscape}${it.suffix}`,
          group: "Current landscape",
        });
      }
    }
    for (const l of landscapes) {
      out.push({
        id: `l-${l.id}`,
        label: l.topic,
        hint: l.status,
        href: `/landscape/${l.id}`,
        group: "Open landscape",
      });
    }
    return out;
  }, [activeLandscape, landscapes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => (c.label + " " + c.hint + " " + c.group).toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  function go(cmd?: Cmd) {
    const target = cmd ?? filtered[cursor];
    if (!target) return;
    close();
    router.push(target.href);
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,.35)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 92vw)",
          background: "var(--panel)",
          border: "1px solid var(--bd)",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,.35)",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go();
            }
          }}
          placeholder="Jump to a landscape, page, or action…"
          style={{
            all: "unset",
            boxSizing: "border-box",
            width: "100%",
            padding: "15px 18px",
            fontSize: 15,
            color: "var(--t1)",
            borderBottom: "1px solid var(--bd)",
          }}
        />
        <div style={{ maxHeight: "52vh", overflowY: "auto", padding: 6 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "18px", color: "var(--t3)", fontSize: 13 }}>No matches.</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(c)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "10px 12px",
                  borderRadius: 9,
                  background: i === cursor ? "var(--sidebar-item)" : "transparent",
                }}
              >
                <span
                  className="font-mono"
                  style={{ fontSize: 9, color: "var(--t4)", letterSpacing: "0.08em", textTransform: "uppercase", width: 96, flex: "none" }}
                >
                  {c.group}
                </span>
                <span style={{ flex: 1, fontSize: 13.5, color: "var(--t1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.label}
                </span>
                <span className="font-mono" style={{ fontSize: 10.5, color: "var(--t4)" }}>{c.hint}</span>
              </button>
            ))
          )}
        </div>
        <div style={{ display: "flex", gap: 14, padding: "8px 14px", borderTop: "1px solid var(--bd)", fontSize: 10.5, color: "var(--t4)" }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
