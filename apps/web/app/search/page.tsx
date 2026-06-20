"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, Landscape } from "../../lib/api";
import { FieldMapLogo } from "../../components/shell/Logo";

type Tag = "hot" | "up" | "new";
const SUGGESTIONS: { t: string; tag: Tag }[] = [
  { t: "Mechanistic interpretability", tag: "hot" },
  { t: "Long-context LLMs", tag: "up" },
  { t: "RAG evaluation", tag: "up" },
  { t: "LLM agents for science", tag: "new" },
  { t: "Test-time compute scaling", tag: "new" },
  { t: "Multimodal reasoning", tag: "hot" },
  { t: "Reward modeling & RLHF", tag: "up" },
  { t: "Model merging", tag: "up" },
  { t: "World models", tag: "hot" },
  { t: "Agentic web browsing", tag: "new" },
  { t: "Speculative decoding", tag: "up" },
  { t: "Diffusion language models", tag: "new" },
];
const TAG_STYLE: Record<Tag, { label: string; fg: string; bg: string }> = {
  hot: { label: "HOT", fg: "#cf4d6f", bg: "rgba(207,77,111,.13)" },
  up: { label: "▲", fg: "var(--good)", bg: "var(--good-bg)" },
  new: { label: "NEW", fg: "var(--accent-ink)", bg: "var(--accent-bg)" },
};

export default function SearchPage() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [maxPapers, setMaxPapers] = useState(30);
  const [parsePdfs, setParsePdfs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [recent, setRecent] = useState<Landscape[]>([]);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 2600);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    apiGet<Landscape[]>("/api/landscapes")
      .then((rows) => setRecent(rows.slice(0, 5)))
      .catch(() => setRecent([]));
  }, []);

  const visibleSuggestions = useMemo(() => {
    const base = tick % SUGGESTIONS.length;
    return [0, 1, 2, 3, 4].map((k) => {
      const it = SUGGESTIONS[(base + k) % SUGGESTIONS.length];
      const seed = tick * 7 + k * 23;
      const cnt = 9 + (seed % 26);
      const spark = [0, 1, 2, 3, 4, 5, 6].map((j) => 5 + ((seed + j * 13) % 12));
      return { ...it, cnt, spark };
    });
  }, [tick]);

  const sugCurrent = SUGGESTIONS[tick % SUGGESTIONS.length].t;
  const sugAgo = ["just now", "2s ago", "4s ago"][tick % 3];

  async function submit(query?: string) {
    const final = (query ?? topic).trim();
    if (!final || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiPost<{ landscape_id: string; job_id: string }>(
        "/api/landscapes",
        { topic: final, max_papers: maxPapers, sources: ["arxiv"], parse_pdfs: parsePdfs }
      );
      router.push(`/jobs/${res.job_id}?landscape=${res.landscape_id}`);
    } catch (err: any) {
      setError(err.message || "Failed to create landscape");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fm-page-roomy"
      style={{
        maxWidth: 700,
        margin: "0 auto",
        padding: "64px 40px",
        animation: "fm-fade .3s ease",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{ display: "inline-block", marginBottom: 22 }}>
          <FieldMapLogo size={50} />
        </div>
        <h1
          style={{
            fontSize: 27,
            fontWeight: 600,
            letterSpacing: "-0.025em",
            margin: "0 0 10px",
          }}
        >
          Map a new research field
        </h1>
        <p
          style={{
            fontSize: 14.5,
            color: "var(--t3)",
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          Enter a topic. FieldMap searches arXiv, ranks &amp; clusters papers, parses
          PDFs, extracts structured notes, and synthesises the landscape into a
          reading plan and study material.
        </p>
      </div>

      <form
        className="fm-search-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{
          border: "1px solid var(--bd)",
          borderRadius: 14,
          background: "var(--panel)",
          padding: 6,
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 16,
          boxShadow: "var(--shadow)",
        }}
      >
        <div className="fm-search-input-row" style={{ display: "contents" }}>
          <svg
            width="17"
            height="17"
            viewBox="0 0 15 15"
            fill="none"
            style={{ marginLeft: 12, flex: "none" }}
          >
            <circle cx="6.5" cy="6.5" r="4.3" stroke="var(--t3)" strokeWidth="1.3" />
            <path d="M9.8 9.8L13 13" stroke="var(--t3)" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            autoFocus
            placeholder={sugCurrent}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            style={{
              all: "unset",
              flex: 1,
              fontSize: 15,
              color: "var(--t1)",
              padding: "12px 0",
              minWidth: 0,
            }}
          />
        </div>
        <button
          className="fm-mobile-full"
          type="submit"
          disabled={submitting}
          style={{
            all: "unset",
            cursor: submitting ? "wait" : "pointer",
            padding: "11px 20px",
            borderRadius: 10,
            background: "var(--accent)",
            color: "#fff",
            fontSize: 13.5,
            fontWeight: 600,
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "Starting…" : "Build landscape"}
        </button>
      </form>

      <div
        className="fm-mobile-stack"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          justifyContent: "center",
          marginBottom: 36,
          flexWrap: "wrap",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 12, color: "var(--t3)" }}>Max papers</span>
          <input
            type="number"
            min={5}
            max={50}
            value={maxPapers}
            onChange={(e) => setMaxPapers(Number(e.target.value) || 30)}
            className="font-mono"
            style={{
              all: "unset",
              fontSize: 12,
              color: "var(--t1)",
              border: "1px solid var(--bd)",
              borderRadius: 6,
              padding: "3px 10px",
              width: 48,
              textAlign: "center",
              background: "var(--panel)",
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => setParsePdfs((v) => !v)}
          style={{
            all: "unset",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <span
            style={{
              width: 34,
              height: 19,
              borderRadius: 999,
              background: parsePdfs ? "var(--accent)" : "var(--bd)",
              position: "relative",
              display: "inline-block",
              transition: "background .15s",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 2,
                left: parsePdfs ? 17 : 2,
                width: 15,
                height: 15,
                borderRadius: "50%",
                background: "#fff",
                transition: "left .15s",
              }}
            />
          </span>
          <span style={{ fontSize: 12, color: "var(--t3)" }}>Parse PDFs</span>
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 12, color: "var(--t3)" }}>Source</span>
          <span style={{ fontSize: 12, color: "var(--t1)" }}>arXiv</span>
        </div>
      </div>

      {error && (
        <div
          style={{
            border: "1px solid var(--warm-bd)",
            background: "var(--warm)",
            color: "var(--bad)",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 12.5,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <div
        className="fm-trending-row"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 14,
        }}
      >
        <span
          className="font-mono"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10,
            color: "var(--t4)",
            letterSpacing: "0.12em",
          }}
        >
          <span
            className="fm-pulse"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--accent)",
            }}
          />
          TRENDING NOW
        </span>
        <span style={{ fontSize: 11, color: "var(--t4)" }}>
          refreshing live · updated {sugAgo}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visibleSuggestions.map((s, i) => {
          const tg = TAG_STYLE[s.tag];
          return (
            <button
              key={s.t + i}
              onClick={() => submit(s.t)}
              className="fm-fadein"
              style={{
                all: "unset",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 13,
                padding: "13px 16px",
                border: "1px solid var(--bd)",
                borderRadius: 11,
                background: "var(--panel)",
                boxShadow: "var(--shadow)",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "3px 8px",
                  borderRadius: 6,
                  color: tg.fg,
                  background: tg.bg,
                  minWidth: 42,
                  textAlign: "center",
                }}
              >
                {tg.label}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{s.t}</div>
              </div>
              <div
                className="fm-trending-spark"
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 2,
                  height: 18,
                }}
              >
                {s.spark.map((h, j) => (
                  <span
                    key={j}
                    style={{
                      width: 3,
                      borderRadius: 1,
                      background: "var(--accent)",
                      opacity: 0.55,
                      height: `${h}px`,
                    }}
                  />
                ))}
              </div>
              <span
                className="font-mono fm-trending-count"
                style={{
                  fontSize: 11,
                  color: "var(--t3)",
                  minWidth: 64,
                  textAlign: "right",
                }}
              >
                {s.cnt} papers
              </span>
              <svg width="13" height="13" viewBox="0 0 15 15" fill="none">
                <path
                  d="M5 3l5 4.5L5 12"
                  stroke="var(--t4)"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          );
        })}
      </div>

      <div
        className="font-mono"
        style={{
          marginTop: 24,
          fontSize: 10,
          color: "var(--t4)",
          letterSpacing: "0.12em",
          marginBottom: 12,
        }}
      >
        YOUR RECENT LANDSCAPES
      </div>

      {recent.length === 0 ? (
        <div
          style={{
            fontSize: 12.5,
            color: "var(--t3)",
            border: "1px dashed var(--bd)",
            borderRadius: 11,
            padding: "14px 16px",
            background: "var(--panel)",
          }}
        >
          No landscapes yet — your first one will appear here once you build it.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {recent.map((r) => (
            <Link
              key={r.id}
              href={`/landscape/${r.id}`}
              style={{
                all: "unset",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 16px",
                border: "1px solid var(--bd)",
                borderRadius: 11,
                background: "var(--panel)",
                boxShadow: "var(--shadow)",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background:
                    r.status === "ready" || r.status === "done"
                      ? "var(--good)"
                      : r.status === "failed"
                      ? "var(--bad)"
                      : "var(--accent)",
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{r.topic}</div>
                <div style={{ fontSize: 11.5, color: "var(--t3)", marginTop: 2 }}>
                  status: {r.status}
                </div>
              </div>
              <span
                className="font-mono"
                style={{ fontSize: 11, color: "var(--t4)" }}
              >
                {new Date(r.created_at).toLocaleDateString()}
              </span>
              <svg width="13" height="13" viewBox="0 0 15 15" fill="none">
                <path
                  d="M5 3l5 4.5L5 12"
                  stroke="var(--t4)"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
