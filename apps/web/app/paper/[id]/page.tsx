"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiGet, apiUrl, Concept, PaperDetail } from "../../../lib/api";
import { confidenceColor } from "../../../lib/clusters";
import ConceptText from "../../../components/concepts/ConceptText";

type Tab = "extraction" | "pdf" | "related";

export default function PaperPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [data, setData] = useState<PaperDetail | null>(null);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("extraction");
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewErr, setPdfPreviewErr] = useState<string | null>(null);
  const pdfPreviewUrlRef = useRef<string | null>(null);
  const [pdfFullscreen, setPdfFullscreen] = useState(false);
  const pdfPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    apiGet<PaperDetail>(`/api/papers/${params.id}`)
      .then((payload) => {
        setData(payload);
        const landscapeId = payload.landscape_ids?.[0];
        if (landscapeId) {
          apiGet<Concept[]>(`/api/landscapes/${landscapeId}/concepts`)
            .then(setConcepts)
            .catch(() => setConcepts([]));
        }
      })
      .catch((e) => setErr(e.message || String(e)));
  }, [params.id]);

  const localPdfUrl = data?.pdf.url ? apiUrl(data.pdf.url, false) : null;

  useEffect(() => {
    if (tab !== "pdf" || !localPdfUrl) return;

    const controller = new AbortController();
    let cancelled = false;
    let objectUrl: string | null = null;

    setPdfPreviewLoading(true);
    setPdfPreviewErr(null);

    fetch(localPdfUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/pdf" },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`PDF preview failed: ${r.status}`);
        const blob = await r.blob();
        const nextUrl = URL.createObjectURL(
          blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" })
        );
        objectUrl = nextUrl;
        if (!cancelled) {
          setPdfPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            pdfPreviewUrlRef.current = nextUrl;
            return nextUrl;
          });
          objectUrl = null;
        }
      })
      .catch((e: any) => {
        if (e?.name !== "AbortError" && !cancelled) {
          setPdfPreviewErr(e.message || "PDF preview failed");
        }
      })
      .finally(() => {
        if (!cancelled) setPdfPreviewLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [tab, localPdfUrl]);

  useEffect(() => {
    if (localPdfUrl) return;
    if (pdfPreviewUrlRef.current) URL.revokeObjectURL(pdfPreviewUrlRef.current);
    pdfPreviewUrlRef.current = null;
    setPdfPreviewUrl(null);
  }, [localPdfUrl]);

  useEffect(() => {
    return () => {
      if (pdfPreviewUrlRef.current) URL.revokeObjectURL(pdfPreviewUrlRef.current);
      pdfPreviewUrlRef.current = null;
    };
  }, []);

  // Sync our pdfFullscreen flag with the browser's Fullscreen API state and
  // wire Esc-to-exit. The browser fires `fullscreenchange` whenever the user
  // exits via chrome (e.g. Esc handled natively, or the browser's own UI), so
  // we mirror that into local state. We also handle Esc ourselves for the
  // CSS-overlay path (iOS Safari, where requestFullscreen on a div is a no-op).
  useEffect(() => {
    if (!pdfFullscreen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => setPdfFullscreen(false));
      } else {
        setPdfFullscreen(false);
      }
    };
    const onFsChange = () => {
      if (!document.fullscreenElement) setPdfFullscreen(false);
    };

    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, [pdfFullscreen]);

  // Leave fullscreen if the user navigates away from the pdf tab.
  useEffect(() => {
    if (tab === "pdf") return;
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    setPdfFullscreen(false);
  }, [tab]);

  const togglePdfFullscreen = () => {
    if (pdfFullscreen) {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => setPdfFullscreen(false));
      } else {
        setPdfFullscreen(false);
      }
      return;
    }
    const el = pdfPanelRef.current;
    if (el && typeof el.requestFullscreen === "function") {
      el.requestFullscreen()
        .then(() => setPdfFullscreen(true))
        .catch(() => setPdfFullscreen(true));
    } else {
      // iOS Safari and similar: fall back to a CSS fixed-overlay.
      setPdfFullscreen(true);
    }
  };

  if (err) {
    return (
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 40px" }}>
        <h1 style={{ fontSize: 22 }}>Paper</h1>
        <div
          style={{
            fontSize: 13,
            color: "var(--bad)",
            background: "rgba(207,77,111,.10)",
            border: "1px solid var(--bad)",
            borderRadius: 12,
            padding: "12px 16px",
            margin: "16px 0",
          }}
        >
          {err}
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ padding: "32px 40px", color: "var(--t3)" }}>Loading…</div>
    );
  }

  const e = (data.extraction || {}) as any;
  const paper = data.paper;
  const landscapeId = data.landscape_ids?.[0] || "";
  const confidence = Math.round((e.confidence || 0) * 100);
  const score = Math.round((e.confidence || 0) * 100); // backend doesn't surface per-paper score on /papers/{id}; mirror confidence
  const catLabel =
    (e.reading_priority as string)?.replace(/-/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase()) ||
    "Useful";
  const catColor =
    e.reading_priority === "must-read"
      ? "#e0613a"
      : e.reading_priority === "useful"
      ? "#2f9d6b"
      : e.reading_priority === "optional"
      ? "#6a8cc0"
      : "#8a867c";

  return (
    <div
      className="fm-page"
      style={{
        maxWidth: 1120,
        margin: "0 auto",
        padding: "28px 40px 72px",
        animation: "fm-fade .3s ease",
      }}
    >
      <button
        onClick={() => router.back()}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "var(--t3)",
          marginBottom: 20,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
          <path
            d="M10 3L5 7.5L10 12"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Back
      </button>

      <div
        className="fm-paper-hero"
        style={{
          border: "1px solid var(--bd)",
          borderRadius: 16,
          background: "var(--panel)",
          padding: "24px 26px",
          marginBottom: 22,
          boxShadow: "var(--shadow)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 11.5,
              padding: "3px 10px",
              borderRadius: 7,
              fontWeight: 600,
              color: "#fff",
              background: catColor,
            }}
          >
            {catLabel}
          </span>
          <span
            className="font-mono"
            style={{ fontSize: 11, color: "var(--t4)" }}
          >
            {paper.venue ? `${paper.venue} ` : ""}{paper.year ?? ""}
            {paper.arxiv_id ? ` · arXiv:${paper.arxiv_id}` : ""}
          </span>
        </div>
        <h1
          style={{
            fontSize: 23,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.25,
            margin: "0 0 10px",
            maxWidth: 780,
          }}
        >
          {paper.title}
        </h1>
        <div style={{ fontSize: 13, color: "var(--t3)" }}>
          {paper.authors.join(", ")}
          {paper.citation_count != null ? ` · ${paper.citation_count} citations` : ""}
        </div>

        <div
          style={{
            display: "flex",
            gap: 28,
            marginTop: 20,
            paddingTop: 20,
            borderTop: "1px solid var(--bd2)",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div>
            <div
              className="font-mono"
              style={{
                fontSize: 9,
                color: "var(--t4)",
                letterSpacing: "0.1em",
                marginBottom: 6,
              }}
            >
              DIFFICULTY
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span
                className="font-mono"
                style={{ fontSize: 21, color: catColor }}
              >
                {e.difficulty_level ?? "—"}
              </span>
              <span style={{ fontSize: 11, color: "var(--t4)" }}>/5</span>
            </div>
          </div>
          <div>
            <div
              className="font-mono"
              style={{
                fontSize: 9,
                color: "var(--t4)",
                letterSpacing: "0.1em",
                marginBottom: 6,
              }}
            >
              EXTRACTION CONFIDENCE
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  width: 96,
                  height: 6,
                  borderRadius: 3,
                  background: "var(--raised)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${confidence}%`,
                    background: confidenceColor(e.confidence || 0),
                  }}
                />
              </div>
              <span
                className="font-mono"
                style={{ fontSize: 13, color: confidenceColor(e.confidence || 0) }}
              >
                {confidence}%
              </span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 10 }} />
          {data.sections.length > 0 && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11,
                padding: "5px 10px",
                borderRadius: 7,
                background: "var(--good-bg)",
                color: "var(--good)",
              }}
            >
              <svg width="11" height="11" viewBox="0 0 15 15">
                <path
                  d="M3 8l3 3 6-7"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Grounded in PDF · {data.sections.length} sections
            </span>
          )}
        </div>
      </div>

      <div
        className="md:hidden"
        style={{
          border: "1px solid var(--warm-bd)",
          borderRadius: 14,
          background: "var(--warm)",
          padding: "13px 15px",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--accent-ink)",
            marginBottom: 5,
          }}
        >
          TL;DR
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--t2)" }}>
          {e.contribution && e.contribution !== "Not reported"
            ? <ConceptText text={e.contribution} concepts={concepts} landscapeId={landscapeId} />
            : e.method && e.method !== "Not reported"
            ? <ConceptText text={e.method} concepts={concepts} landscapeId={landscapeId} />
            : <ConceptText text={e.problem || paper.abstract || "Summary not reported yet."} concepts={concepts} landscapeId={landscapeId} />}
        </div>
      </div>

      {e.motivation && (
        <div
          style={{
            border: "1px solid var(--warm-bd)",
            borderRadius: 12,
            background: "var(--warm)",
            padding: "15px 18px",
            marginBottom: 22,
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--accent)",
              boxShadow: "0 0 8px var(--accent)",
              marginTop: 5,
              flex: "none",
            }}
          />
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--accent-ink)" }}>
              Why read this —{" "}
            </span>
            <span style={{ fontSize: 13, color: "var(--t2)" }}>
              <ConceptText text={e.motivation} concepts={concepts} landscapeId={landscapeId} />
            </span>
          </div>
        </div>
      )}

      <div
        className="fm-paper-tabs"
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid var(--bd)",
          marginBottom: 24,
        }}
      >
        <TabBtn label="Structured notes" active={tab === "extraction"} onClick={() => setTab("extraction")} />
        <TabBtn
          label="Paper PDF"
          active={tab === "pdf"}
          onClick={() => setTab("pdf")}
          rightSlot={
            <span
              className="font-mono"
              style={{
                fontSize: 9,
                padding: "1px 5px",
                borderRadius: 4,
                background: "var(--accent-bg)",
                color: "var(--accent-ink)",
                marginLeft: 6,
              }}
            >
              embedded
            </span>
          }
        />
        <TabBtn label="Related" active={tab === "related"} onClick={() => setTab("related")} />
      </div>

      {tab === "extraction" && (
        <div
          className="fm-extraction-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            alignItems: "start",
          }}
        >
          <ExtCard wide label="PROBLEM" color="#5b8def">
            <ConceptText text={e.problem || "Not reported"} concepts={concepts} landscapeId={landscapeId} />
          </ExtCard>
          <ExtCard label="METHOD" color="#2f9d6b">
            <ConceptText text={e.method || "Not reported"} concepts={concepts} landscapeId={landscapeId} />
          </ExtCard>
          <ExtCard label="CONTRIBUTION" color="var(--accent-ink)">
            <ConceptText text={e.contribution || "Not reported"} concepts={concepts} landscapeId={landscapeId} />
          </ExtCard>
          <ExtCardList label="RESULTS" color="#8b6ae0" items={e.results} bullet="▸" concepts={concepts} landscapeId={landscapeId} />
          <ExtCardList label="LIMITATIONS" color="var(--bad)" items={e.limitations} bullet="▸" concepts={concepts} landscapeId={landscapeId} />
          <ExtCardChips label="PREREQUISITES" color="var(--warn)" items={e.prerequisites} />
          <ExtCardList
            label="IMPLEMENTATION NOTES"
            color="#2f9d9d"
            items={e.implementation_details}
            bullet="$"
            concepts={concepts}
            landscapeId={landscapeId}
          />
          {Array.isArray(e.key_terms) && e.key_terms.length > 0 && (
            <ExtCardChips label="KEY TERMS" color="#5b8def" items={e.key_terms} />
          )}
          {Array.isArray(e.datasets) && e.datasets.length > 0 && (
            <ExtCardChips label="DATASETS" color="#2f9d6b" items={e.datasets} />
          )}
          {Array.isArray(e.open_questions) && e.open_questions.length > 0 && (
            <ExtCardList label="OPEN QUESTIONS" color="var(--bad)" items={e.open_questions} bullet="?" concepts={concepts} landscapeId={landscapeId} />
          )}
          {Array.isArray(e.source_grounding) && e.source_grounding.length > 0 && (
            <GroundingCard items={e.source_grounding} />
          )}
        </div>
      )}

      {tab === "pdf" && (
        <div
          ref={pdfPanelRef}
          style={{
            border: "1px solid var(--bd)",
            borderRadius: pdfFullscreen ? 0 : 14,
            background: "var(--panel)",
            overflow: "hidden",
            boxShadow: pdfFullscreen ? "none" : "var(--shadow)",
            ...(pdfFullscreen
              ? {
                  position: "fixed" as const,
                  inset: 0,
                  zIndex: 9999,
                  width: "100vw",
                  height: "100vh",
                  display: "flex",
                  flexDirection: "column" as const,
                }
              : {}),
          }}
        >
          <div
            className="fm-pdf-toolbar"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "11px 16px",
              borderBottom: "1px solid var(--bd)",
              background: "var(--raised)",
              flex: "none",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontSize: 12,
                color: "var(--t2)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
                <path
                  d="M3 1.5h6l3 3v9a.5.5 0 01-.5.5h-8a.5.5 0 01-.5-.5v-11.5a.5.5 0 01.5-.5z"
                  stroke="var(--bad)"
                  strokeWidth="1.1"
                />
              </svg>
              {paper.title.slice(0, 60)}
              {paper.title.length > 60 ? "…" : ""}
            </span>
            <span
              className="font-mono"
              style={{ fontSize: 11, color: "var(--t4)" }}
            >
              {paper.arxiv_id ? `arXiv:${paper.arxiv_id}` : paper.external_id}
            </span>
            <div style={{ flex: 1 }} />
            {localPdfUrl && (
              <a
                href={localPdfUrl.replace(/\/pdf$/, '/pdf/download')}
                style={{
                  fontSize: 11.5,
                  color: "var(--t2)",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "5px 10px",
                  borderRadius: 7,
                  border: "1px solid var(--bd)",
                  background: "var(--raised)",
                  textDecoration: "none",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
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
                Download
              </a>
            )}
            {paper.url && (
              <a
                href={paper.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: 11.5,
                  color: "var(--accent-ink)",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
                  <path
                    d="M9 2h4v4M13 2L8 7M6 3H3.5a1 1 0 00-1 1v7.5a1 1 0 001 1H11a1 1 0 001-1V9"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Open on arXiv
              </a>
            )}
            {localPdfUrl && (
              <button
                type="button"
                onClick={togglePdfFullscreen}
                aria-label={pdfFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                title={pdfFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  fontSize: 11.5,
                  color: "var(--t2)",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "5px 10px",
                  borderRadius: 7,
                  border: "1px solid var(--bd)",
                  background: "var(--raised)",
                }}
              >
                {pdfFullscreen ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
                      <path
                        d="M5.5 1.5v4h-4M9.5 1.5v4h4M5.5 13.5v-4h-4M9.5 13.5v-4h4"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="fm-mobile-hide">Exit fullscreen</span>
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 15 15" fill="none">
                      <path
                        d="M1.5 5.5v-4h4M13.5 5.5v-4h-4M1.5 9.5v4h4M13.5 9.5v4h-4"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="fm-mobile-hide">Fullscreen</span>
                  </>
                )}
              </button>
            )}
          </div>

          <div
            style={{
              padding: pdfFullscreen ? 0 : 16,
              flex: pdfFullscreen ? 1 : "none",
              minHeight: 0,
            }}
          >
            {localPdfUrl ? (
              pdfPreviewErr ? (
                <div
                  style={{
                    padding: 16,
                    fontSize: 13,
                    color: "var(--bad)",
                    border: "1px dashed var(--bad)",
                    borderRadius: 8,
                    background: "rgba(207,77,111,.10)",
                  }}
                >
                  {pdfPreviewErr}
                </div>
              ) : pdfPreviewUrl ? (
                <iframe
                  src={pdfPreviewUrl}
                  className="fm-pdf-preview"
                  style={{
                    width: "100%",
                    height: pdfFullscreen ? "100%" : "72vh",
                    border: pdfFullscreen ? "none" : "1px solid var(--bd)",
                    borderRadius: pdfFullscreen ? 0 : 8,
                    display: "block",
                  }}
                  title="PDF preview"
                />
              ) : (
                <div
                  className="fm-pdf-preview"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "100%",
                    height: pdfFullscreen ? "100%" : "72vh",
                    border: pdfFullscreen ? "none" : "1px solid var(--bd)",
                    borderRadius: pdfFullscreen ? 0 : 8,
                    background: "var(--raised)",
                    color: "var(--t3)",
                    fontSize: 13,
                  }}
                >
                  {pdfPreviewLoading ? "Loading embedded PDF..." : "Preparing embedded PDF..."}
                </div>
              )
            ) : paper.pdf_url ? (
              <div
                style={{
                  padding: 16,
                  fontSize: 13,
                  color: "var(--t3)",
                  border: "1px dashed var(--bd)",
                  borderRadius: 8,
                  background: "var(--raised)",
                }}
              >
                Local PDF isn't available yet —{" "}
                <a href={paper.pdf_url} target="_blank" rel="noreferrer">
                  open the external PDF
                </a>
                .
              </div>
            ) : (
              <div
                style={{
                  padding: 16,
                  fontSize: 13,
                  color: "var(--t3)",
                  border: "1px dashed var(--bd)",
                  borderRadius: 8,
                  background: "var(--raised)",
                }}
              >
                No PDF URL on file.
              </div>
            )}
          </div>

          {data.sections.length > 0 && !pdfFullscreen && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 16px",
                borderTop: "1px solid var(--bd)",
                background: "var(--raised)",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  color: "var(--good)",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--good)",
                  }}
                />
                text layer extracted
              </span>
              <span style={{ fontSize: 11, color: "var(--t4)" }}>
                — structured notes are grounded in this parsed text, not the rendered
                image.
              </span>
            </div>
          )}
        </div>
      )}

      {tab === "related" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <div style={{ fontSize: 12, color: "var(--t3)", marginBottom: 4 }}>
            Papers most connected to this one in the landscape graph.
          </div>
          {Array.isArray(e.related_papers) && e.related_papers.length > 0 ? (
            e.related_papers.map((rel: any, i: number) => {
              const title = typeof rel === "string" ? rel : rel.title || JSON.stringify(rel);
              const relation = typeof rel === "object" ? rel.relation : null;
              const paperId = typeof rel === "object" ? rel.paper_id : null;
              const url = typeof rel === "object" ? rel.url : null;

              const cardStyle = {
                display: "flex",
                alignItems: "center",
                gap: 12,
                border: "1px solid var(--bd)",
                borderRadius: 12,
                background: "var(--panel)",
                padding: "14px 16px",
                boxShadow: "var(--shadow)",
                color: "inherit",
                textDecoration: "none",
              } as const;

              const inner = (
                <>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: paperId ? "var(--accent)" : url ? "#5b8def" : "var(--t4)",
                      flex: "none",
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>
                    {title}
                  </span>
                  {relation && (
                    <span
                      className="font-mono"
                      style={{ fontSize: 11, color: "var(--t3)" }}
                    >
                      {relation}
                    </span>
                  )}
                  {paperId ? (
                    <svg width="14" height="14" viewBox="0 0 15 15" fill="none" style={{ flex: "none" }}>
                      <path
                        d="M5 3l5 4.5L5 12"
                        stroke="var(--t4)"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : url ? (
                    <svg width="12" height="12" viewBox="0 0 15 15" fill="none" style={{ flex: "none" }}>
                      <path
                        d="M9 2h4v4M13 2L8 7M6 3H3.5a1 1 0 00-1 1v7.5a1 1 0 001 1H11a1 1 0 001-1V9"
                        stroke="var(--t4)"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </>
              );

              if (paperId) {
                return (
                  <Link key={i} href={`/paper/${paperId}`} style={{ ...cardStyle, cursor: "pointer" }}>
                    {inner}
                  </Link>
                );
              }
              if (url) {
                return (
                  <a key={i} href={url} target="_blank" rel="noreferrer" style={{ ...cardStyle, cursor: "pointer" }}>
                    {inner}
                  </a>
                );
              }
              return (
                <div key={i} style={cardStyle}>
                  {inner}
                </div>
              );
            })
          ) : (
            <div
              style={{
                fontSize: 13,
                color: "var(--t3)",
                border: "1px dashed var(--bd)",
                borderRadius: 12,
                padding: "16px 18px",
                background: "var(--panel)",
              }}
            >
              No related papers in the extraction yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TabBtn({
  label,
  active,
  onClick,
  rightSlot,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  rightSlot?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        all: "unset",
        cursor: "pointer",
        fontSize: 13,
        padding: "11px 15px",
        color: active ? "var(--t1)" : "var(--t3)",
        boxShadow: `inset 0 -2px 0 ${active ? "var(--accent)" : "transparent"}`,
        display: "flex",
        alignItems: "center",
      }}
    >
      {label}
      {rightSlot}
    </button>
  );
}

function ExtCard({
  label,
  color,
  children,
  wide,
}: {
  label: string;
  color: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      style={{
        gridColumn: wide ? "1 / -1" : undefined,
        border: "1px solid var(--bd)",
        borderRadius: 14,
        background: "var(--panel)",
        padding: "18px 20px",
        boxShadow: "var(--shadow)",
      }}
    >
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          color,
          letterSpacing: "0.1em",
          marginBottom: 9,
        }}
      >
        {label}
      </div>
      <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--t2)", margin: 0 }}>
        {children}
      </p>
    </div>
  );
}

function ExtCardList({
  label,
  color,
  items,
  bullet,
  concepts,
  landscapeId,
}: {
  label: string;
  color: string;
  items: any;
  bullet: string;
  concepts: Concept[];
  landscapeId: string;
}) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 14,
        background: "var(--panel)",
        padding: "18px 20px",
        boxShadow: "var(--shadow)",
      }}
    >
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          color,
          letterSpacing: "0.1em",
          marginBottom: 11,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((it: any, i: number) => (
          <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
            <span style={{ color, fontSize: 12, marginTop: 1 }}>{bullet}</span>
            <span style={{ fontSize: 13, lineHeight: 1.55, color: "var(--t2)" }}>
              <ConceptText
                text={typeof it === "string" ? it : JSON.stringify(it)}
                concepts={concepts}
                landscapeId={landscapeId}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function groundingSource(g: any): string {
  const parts: string[] = [];
  if (g.section) parts.push(String(g.section));
  if (g.page != null) parts.push(`page ${g.page}`);
  if (g.chunk_ordinal != null) parts.push(`chunk ${g.chunk_ordinal}`);
  else if (g.chunk_id) parts.push(`chunk ${g.chunk_id}`);
  return parts.join(" · ") || "source unavailable";
}

function GroundingCard({ items }: { items: any[] }) {
  return (
    <div
      style={{
        gridColumn: "1 / -1",
        border: "1px solid var(--bd)",
        borderRadius: 14,
        background: "var(--panel)",
        padding: "18px 20px",
        boxShadow: "var(--shadow)",
      }}
    >
      <div
        className="font-mono"
        style={{ fontSize: 10, color: "var(--good)", letterSpacing: "0.1em", marginBottom: 4 }}
      >
        SOURCE GROUNDING
      </div>
      <div style={{ fontSize: 11.5, color: "var(--t4)", marginBottom: 13 }}>
        Each claim is traced back to the parsed PDF — section, page, and chunk.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((g: any, i: number) => {
          const conf = Math.round((g.confidence || 0) * 100);
          return (
            <div
              key={i}
              style={{
                borderLeft: "2px solid var(--bd2)",
                paddingLeft: 12,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span
                  className="font-mono"
                  style={{
                    fontSize: 10,
                    padding: "2px 7px",
                    borderRadius: 5,
                    background: "var(--raised)",
                    border: "1px solid var(--bd)",
                    color: "var(--t2)",
                  }}
                >
                  {String(g.field || "").replace(/_/g, " ")}
                </span>
                <span className="font-mono" style={{ fontSize: 11, color: "var(--t3)" }}>
                  {groundingSource(g)}
                </span>
                {g.confidence != null && (
                  <span
                    className="font-mono"
                    style={{ fontSize: 10.5, color: confidenceColor(g.confidence || 0) }}
                  >
                    {conf}%
                  </span>
                )}
              </div>
              {g.quote && (
                <div
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    color: "var(--t2)",
                    fontStyle: "italic",
                  }}
                >
                  “{g.quote}”
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExtCardChips({
  label,
  color,
  items,
}: {
  label: string;
  color: string;
  items: any;
}) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 14,
        background: "var(--panel)",
        padding: "18px 20px",
        boxShadow: "var(--shadow)",
      }}
    >
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          color,
          letterSpacing: "0.1em",
          marginBottom: 11,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {items.map((it: any, i: number) => (
          <span
            key={i}
            style={{
              fontSize: 11.5,
              padding: "6px 11px",
              borderRadius: 999,
              background: "var(--raised)",
              border: "1px solid var(--bd)",
              color: "var(--t2)",
            }}
          >
            {typeof it === "string" ? it : JSON.stringify(it)}
          </span>
        ))}
      </div>
    </div>
  );
}
