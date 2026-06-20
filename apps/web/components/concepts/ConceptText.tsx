"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Concept } from "../../lib/api";

type Segment =
  | { type: "text"; text: string }
  | { type: "concept"; text: string; concept: Concept };

export default function ConceptText({
  text,
  concepts,
  landscapeId,
  className,
}: {
  text: string;
  concepts: Concept[];
  landscapeId: string;
  className?: string;
}) {
  const [active, setActive] = useState<Concept | null>(null);
  const [mounted, setMounted] = useState(false);
  const segments = useMemo(() => annotate(text || "", concepts || []), [text, concepts]);

  useEffect(() => setMounted(true), []);

  if (!text) return null;

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === "text") return <span key={i}>{seg.text}</span>;
        const href = `/landscape/${landscapeId}/concepts/${seg.concept.slug}`;
        return (
          <span key={`${seg.concept.slug}-${i}`} className="fm-concept-wrap">
            <button
              type="button"
              className="fm-concept-term"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setActive(seg.concept);
              }}
              onFocus={() => setActive(seg.concept)}
              aria-label={`${seg.text}: ${seg.concept.short_definition}`}
            >
              {seg.text}
            </button>
            <span className="fm-concept-popover" role="tooltip">
              <strong>{seg.concept.term}</strong>
              <span>{seg.concept.short_definition}</span>
              <Link href={href}>Open concept</Link>
            </span>
          </span>
        );
      })}
      {mounted && active
        ? createPortal(
            <div
              className="fm-concept-sheet"
              role="dialog"
              aria-modal="true"
              aria-label={active.term}
              onClick={() => setActive(null)}
            >
              <div className="fm-concept-card" onClick={(event) => event.stopPropagation()}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 6 }}>
                      {active.term}
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--t2)" }}>
                      {active.short_definition}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActive(null)}
                    aria-label="Close concept card"
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      color: "var(--t3)",
                      fontSize: 18,
                      lineHeight: 1,
                    }}
                  >
                    x
                  </button>
                </div>
                {active.why_it_matters && (
                  <div
                    style={{
                      marginTop: 12,
                      paddingTop: 12,
                      borderTop: "1px solid var(--bd2)",
                      fontSize: 12.5,
                      lineHeight: 1.5,
                      color: "var(--t3)",
                    }}
                  >
                    {active.why_it_matters}
                  </div>
                )}
                <Link
                  href={`/landscape/${landscapeId}/concepts/${active.slug}`}
                  className="fm-concept-open"
                >
                  Open concept
                </Link>
              </div>
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

function annotate(text: string, concepts: Concept[]): Segment[] {
  const matchers = concepts
    .filter((c) => (c.confidence ?? 0) >= 0.55)
    .flatMap((c) => [c.term, ...(c.aliases || [])].map((term) => ({ term: clean(term), concept: c })))
    .filter((x) => x.term && !isGeneric(x.term))
    .sort((a, b) => b.term.length - a.term.length);
  if (!matchers.length) return [{ type: "text", text }];

  const protectedRanges = rangesForMarkdown(text);
  const paragraphRanges = paragraphs(text);
  const occupied: [number, number][] = [];
  const seen = new Set<string>();
  const matches: { start: number; end: number; concept: Concept }[] = [];

  for (const matcher of matchers) {
    const pattern = new RegExp(`(^|[^\\w-])(${escapeRegex(matcher.term).replace(/\\ /g, "\\s+")})(?![\\w-])`, "gi");
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text))) {
      const start = m.index + (m[1]?.length || 0);
      const end = start + m[2].length;
      if (matches.length >= 24) break;
      if (overlaps(start, end, protectedRanges) || overlaps(start, end, occupied)) continue;
      const para = paragraphIndex(start, paragraphRanges);
      const key = `${para}:${matcher.concept.slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      occupied.push([start, end]);
      matches.push({ start, end, concept: matcher.concept });
    }
  }

  if (!matches.length) return [{ type: "text", text }];
  matches.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let pos = 0;
  for (const match of matches) {
    if (match.start > pos) out.push({ type: "text", text: text.slice(pos, match.start) });
    out.push({ type: "concept", text: text.slice(match.start, match.end), concept: match.concept });
    pos = match.end;
  }
  if (pos < text.length) out.push({ type: "text", text: text.slice(pos) });
  return out;
}

function clean(term: string): string {
  return String(term || "").replace(/\s+/g, " ").trim().replace(/^[\s:;,.()[\]{}-]+|[\s:;,.()[\]{}-]+$/g, "");
}

function isGeneric(term: string): boolean {
  const generic = new Set(["approach", "data", "dataset", "evaluation", "method", "model", "paper", "result", "results", "system", "task"]);
  const words = term.toLowerCase().split(/\s+/);
  return !term || term.length < 3 || words.length > 8 || (words.length === 1 && generic.has(words[0]));
}

function rangesForMarkdown(text: string): [number, number][] {
  const patterns = [/```[\s\S]*?```/g, /`[^`\n]+`/g, /\[[^\]]+\]\([^)]+\)/g, /^#{1,6}\s.*$/gm];
  return patterns.flatMap((pattern) => Array.from(text.matchAll(pattern), (m) => [m.index || 0, (m.index || 0) + m[0].length] as [number, number]));
}

function paragraphs(text: string): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  for (const m of text.matchAll(/\n\s*\n/g)) {
    out.push([start, m.index || 0]);
    start = (m.index || 0) + m[0].length;
  }
  out.push([start, text.length]);
  return out;
}

function paragraphIndex(pos: number, ranges: [number, number][]): number {
  const idx = ranges.findIndex(([start, end]) => start <= pos && pos <= end);
  return idx >= 0 ? idx : ranges.length;
}

function overlaps(start: number, end: number, ranges: [number, number][]): boolean {
  return ranges.some(([a, b]) => start < b && end > a);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
