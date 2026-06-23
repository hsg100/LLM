"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Concept } from "../../lib/api";
import { getSegments, Segment } from "../../lib/annotation";

type Resolved =
  | { type: "text"; text: string }
  | { type: "concept"; text: string; slug: string; concept: Concept | null; definition: string };

export default function ConceptText({
  text,
  concepts,
  landscapeId,
  className,
  segments: provided,
}: {
  text: string;
  concepts: Concept[];
  landscapeId: string;
  className?: string;
  segments?: Segment[];
}) {
  const [active, setActive] = useState<Concept | null>(null);
  const [mounted, setMounted] = useState(false);
  const [segments, setSegments] = useState<Segment[] | null>(provided ?? null);

  const bySlug = useMemo(() => {
    const m = new Map<string, Concept>();
    for (const c of concepts || []) m.set(c.slug, c);
    return m;
  }, [concepts]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (provided) {
      setSegments(provided);
      return;
    }
    let cancelled = false;
    // Server is the single source of truth; render plain text until it resolves.
    getSegments(landscapeId, text || "")
      .then((segs) => {
        if (!cancelled) setSegments(segs);
      })
      .catch(() => {
        if (!cancelled) setSegments([{ type: "text", text: text || "" }]);
      });
    return () => {
      cancelled = true;
    };
  }, [text, landscapeId, provided]);

  const resolved: Resolved[] = useMemo(() => {
    const segs = segments ?? [{ type: "text", text: text || "" }];
    return segs.map((seg) => {
      if (seg.type === "text") return { type: "text", text: seg.text };
      const concept = bySlug.get(seg.concept_slug) ?? null;
      return {
        type: "concept",
        text: seg.text,
        slug: seg.concept_slug,
        concept,
        definition: concept?.short_definition || seg.definition || "",
      };
    });
  }, [segments, bySlug, text]);

  if (!text) return null;

  return (
    <span className={className}>
      {resolved.map((seg, i) => {
        if (seg.type === "text") return <span key={i}>{seg.text}</span>;
        const href = `/landscape/${landscapeId}/concepts/${seg.slug}`;
        return (
          <span key={`${seg.slug}-${i}`} className="fm-concept-wrap">
            <button
              type="button"
              className="fm-concept-term"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (seg.concept) setActive(seg.concept);
              }}
              onFocus={() => seg.concept && setActive(seg.concept)}
              aria-label={`${seg.text}: ${seg.definition}`}
            >
              {seg.text}
            </button>
            <span className="fm-concept-popover" role="tooltip">
              <strong>{seg.concept?.term ?? seg.text}</strong>
              <span>{seg.definition}</span>
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
