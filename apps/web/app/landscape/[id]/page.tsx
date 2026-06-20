import Link from "next/link";
import {
  apiGet,
  Concept,
  Flashcard,
  Landscape,
  LandscapePaper,
  Quiz,
} from "../../../lib/api";
import { CLUSTER_PALETTE, clusterColor } from "../../../lib/clusters";
import ConceptText from "../../../components/concepts/ConceptText";

export const dynamic = "force-dynamic";

export default async function LandscapeOverview({ params }: { params: { id: string } }) {
  let landscape: Landscape | null = null;
  let papers: LandscapePaper[] = [];
  let quiz: Quiz[] = [];
  let cards: Flashcard[] = [];
  let concepts: Concept[] = [];
  let loadError: string | null = null;
  try {
    [landscape, papers, quiz, cards, concepts] = await Promise.all([
      apiGet<Landscape>(`/api/landscapes/${params.id}`),
      apiGet<LandscapePaper[]>(`/api/landscapes/${params.id}/papers`).catch(
        () => [] as LandscapePaper[]
      ),
      apiGet<Quiz[]>(`/api/landscapes/${params.id}/quiz`).catch(() => [] as Quiz[]),
      apiGet<Flashcard[]>(`/api/landscapes/${params.id}/flashcards`).catch(
        () => [] as Flashcard[]
      ),
      apiGet<Concept[]>(`/api/landscapes/${params.id}/concepts`).catch(
        () => [] as Concept[]
      ),
    ]);
  } catch (e: any) {
    loadError = e?.message || String(e);
  }

  if (!landscape) {
    return (
      <div
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "32px 40px",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>Landscape</h1>
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
          Could not load this landscape: {loadError || "not found"}
        </div>
        <Link
          href="/search"
          style={{
            display: "inline-block",
            padding: "8px 14px",
            border: "1px solid var(--bd)",
            borderRadius: 9,
            fontSize: 13,
          }}
        >
          New landscape
        </Link>
      </div>
    );
  }

  const s = (landscape.synthesis || {}) as any;
  const mustRead = papers.filter((p) => p.category === "must-read");
  const yearMin = papers.reduce(
    (acc, p) => (p.paper.year ? Math.min(acc, p.paper.year) : acc),
    9999
  );
  const yearMax = papers.reduce(
    (acc, p) => (p.paper.year ? Math.max(acc, p.paper.year) : acc),
    0
  );
  const fieldSpan =
    yearMax > 0
      ? `'${String(yearMin).slice(-2)}–'${String(yearMax).slice(-2)}`
      : "—";
  const spanYears = yearMax > 0 ? `${yearMax - yearMin + 1} yrs` : "—";

  const clusters: { name: string; summary: string; color: string; count: number }[] =
    Array.isArray(s.clusters) && s.clusters.length
      ? s.clusters.map((c: any, i: number) => ({
          name: c.name,
          summary: c.summary,
          color: clusterColor(c.id || c.name) || CLUSTER_PALETTE[i % CLUSTER_PALETTE.length],
          count: Array.isArray(c.paper_ids) ? c.paper_ids.length : 0,
        }))
      : [];

  const timeline: { when: string; title: string; note: string; color: string }[] =
    Array.isArray(s.method_timeline) && s.method_timeline.length
      ? s.method_timeline.map((t: any, i: number) => ({
          when: t.when || t.date || `${i + 1}`,
          title: t.title || t.name || "Milestone",
          note: t.note || t.summary || "",
          color: CLUSTER_PALETTE[i % CLUSTER_PALETTE.length],
        }))
      : [];

  // Build "Read this first" — first 3 must-reads (or top scored).
  const readFirst = (mustRead.length ? mustRead : papers.slice(0, 3)).slice(0, 3);

  const overviewSummary: string =
    s.field_overview ||
    s.why_it_matters ||
    s.overview ||
    s.summary ||
    s.field_summary ||
    "Synthesis is still being generated. Browse the papers list to see what's been ranked so far.";

  // ---------------------------------------------------------------------
  // Pre-compute everything the mobile Today block needs so it can be
  // rendered inline (visible only via the `md:hidden` class).
  // ---------------------------------------------------------------------
  const readFirstAll = (mustRead.length ? mustRead : papers).slice(0, 3);
  // "Continue reading" = the next must-read after the first two (the
  // reading-plan heuristic treats indices 0-1 as done).
  const continueReading = readFirstAll[2] ?? readFirstAll[0] ?? null;
  const continueCluster = continueReading
    ? clusterColor(continueReading.cluster_id)
    : "var(--accent)";

  return (
    <>
      {/* =================== MOBILE: TODAY / HOME =================== */}
      <div
        className="md:hidden"
        style={{
          padding: "16px 18px 40px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          animation: "fm-fade .3s ease",
        }}
      >
        <div>
          <div
            className="font-mono"
            style={{
              fontSize: 10,
              color: "var(--accent-ink)",
              letterSpacing: "0.12em",
              marginBottom: 6,
            }}
          >
            FIELD OVERVIEW
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            {landscape.topic}
          </h1>
        </div>

        {(cards.length > 0 || quiz.length > 0) && (
          <section
            style={{
              border: "1px solid var(--warm-bd)",
              borderRadius: 18,
              background: "var(--warm)",
              padding: "16px 17px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  boxShadow: "0 0 8px var(--accent)",
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Due today</span>
              <span
                className="font-mono"
                style={{ marginLeft: "auto", fontSize: 11, color: "var(--t3)" }}
              >
                spaced review
              </span>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {cards.length > 0 && (
                <Link
                  href={`/landscape/${landscape.id}/flashcards`}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    padding: "13px 0",
                    borderRadius: 13,
                    background: "var(--accent)",
                    color: "#fff",
                    textDecoration: "none",
                  }}
                >
                  <div
                    className="font-mono"
                    style={{ fontSize: 22, fontWeight: 500 }}
                  >
                    {cards.length}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.9, marginTop: 2 }}>
                    flashcards
                  </div>
                </Link>
              )}
              {quiz.length > 0 && (
                <Link
                  href={`/landscape/${landscape.id}/quiz`}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    padding: "13px 0",
                    borderRadius: 13,
                    background: "var(--panel)",
                    border: "1px solid var(--bd)",
                    color: "var(--t1)",
                    textDecoration: "none",
                  }}
                >
                  <div
                    className="font-mono"
                    style={{ fontSize: 22, fontWeight: 500 }}
                  >
                    {quiz.length}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 2 }}>
                    quiz Qs
                  </div>
                </Link>
              )}
            </div>
          </section>
        )}

        {continueReading && (
          <section>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--t3)",
                marginBottom: 9,
              }}
            >
              Continue reading
            </div>
            <Link
              href={`/paper/${continueReading.paper.id}`}
              style={{
                display: "block",
                border: "1px solid var(--bd)",
                borderRadius: 16,
                background: "var(--panel)",
                padding: "15px 16px",
                boxShadow: "var(--shadow)",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: continueCluster,
                  }}
                />
                <span style={{ fontSize: 11, color: "var(--t3)" }}>
                  Next up · {continueReading.paper.year ?? "—"}
                </span>
              </div>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 600,
                  marginBottom: 10,
                  lineHeight: 1.3,
                }}
              >
                {continueReading.paper.title.split(":")[0]}
              </div>
              <div
                style={{
                  height: 5,
                  borderRadius: 3,
                  background: "var(--raised)",
                  overflow: "hidden",
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: "40%",
                    background: "var(--accent)",
                  }}
                />
              </div>
              <div style={{ fontSize: 11, color: "var(--t4)" }}>
                Resume reading
              </div>
            </Link>
          </section>
        )}

        {readFirstAll.length > 0 && (
          <section>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--t3)",
                marginBottom: 9,
              }}
            >
              Read this first
            </div>
            <div
              style={{
                border: "1px solid var(--bd)",
                borderRadius: 16,
                background: "var(--panel)",
                overflow: "hidden",
                boxShadow: "var(--shadow)",
              }}
            >
              {readFirstAll.map((p, i) => (
                <Link
                  key={p.paper.id}
                  href={`/paper/${p.paper.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "13px 16px",
                    borderBottom:
                      i < readFirstAll.length - 1
                        ? "1px solid var(--bd2)"
                        : "none",
                    color: "inherit",
                    textDecoration: "none",
                  }}
                >
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 12,
                      color: "var(--accent)",
                      width: 18,
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                      {p.paper.title.split(":")[0]}
                    </div>
                    {p.rationale && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--t3)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        <ConceptText text={p.rationale} concepts={concepts} landscapeId={landscape.id} />
                      </div>
                    )}
                  </div>
                  {p.category === "must-read" && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: "2px 7px",
                        borderRadius: 5,
                        color: "#fff",
                        background: "var(--accent)",
                      }}
                    >
                      Must
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}

        <Link
          href={`/landscape/${landscape.id}/papers`}
          style={{
            textAlign: "center",
            padding: "12px",
            borderRadius: 11,
            border: "1px solid var(--bd)",
            background: "var(--panel)",
            color: "var(--t2)",
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          See all {papers.length} papers →
        </Link>
      </div>

      {/* =================== DESKTOP: RICH OVERVIEW =================== */}
    <div
      className="hidden md:block"
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "36px 40px 72px",
        animation: "fm-fade .3s ease",
      }}
    >
      <div style={{ marginBottom: 28 }}>
        <div
          className="font-mono"
          style={{
            fontSize: 11,
            color: "var(--accent-ink)",
            letterSpacing: "0.1em",
            marginBottom: 10,
          }}
        >
          FIELD OVERVIEW
        </div>
        <h1
          style={{
            fontSize: 27,
            fontWeight: 600,
            letterSpacing: "-0.025em",
            margin: "0 0 14px",
            lineHeight: 1.2,
          }}
        >
          {landscape.topic}
        </h1>
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.7,
            color: "var(--t2)",
            margin: 0,
            maxWidth: 780,
          }}
        >
          <ConceptText text={overviewSummary} concepts={concepts} landscapeId={landscape.id} />
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          marginBottom: 32,
        }}
      >
        <StatCard value={String(papers.length)} label="papers ranked" />
        <StatCard
          value={String(mustRead.length)}
          label="must-read to start"
          accent
        />
        <StatCard
          value={String(clusters.length || (Array.isArray(s.clusters) ? s.clusters.length : 0))}
          label="research clusters"
        />
        <StatCard
          value={yearMax > 0 ? fieldSpan : "—"}
          label={yearMax > 0 ? `field span · ${spanYears}` : "field span"}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 332px",
          gap: 24,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* read this first */}
          {readFirst.length > 0 && (
            <section
              style={{
                border: "1px solid var(--warm-bd)",
                borderRadius: 16,
                background: "var(--warm)",
                overflow: "hidden",
                boxShadow: "var(--shadow)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "16px 20px",
                  borderBottom: "1px solid var(--warm-bd)",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "var(--accent)",
                    boxShadow: "0 0 8px var(--accent)",
                  }}
                />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>Read this first</span>
                <span style={{ fontSize: 12, color: "var(--t3)", marginLeft: 4 }}>
                  the {readFirst.length}-paper on-ramp into the field
                </span>
              </div>
              {readFirst.map((p, i) => (
                <Link
                  key={p.paper.id}
                  href={`/paper/${p.paper.id}`}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 15,
                    padding: "15px 20px",
                    borderBottom: "1px solid var(--warm-bd)",
                  }}
                >
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 13,
                      color: "var(--accent)",
                      width: 18,
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 3 }}>
                      {p.paper.title.split(":")[0]}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--t3)" }}>
                      <ConceptText
                        text={p.rationale || "Ranked must-read for this field."}
                        concepts={concepts}
                        landscapeId={landscape.id}
                      />
                    </div>
                  </div>
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 11,
                      color: "var(--t3)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.paper.authors[0]?.split(" ").pop() ?? "—"} · {p.paper.year ?? "—"}
                  </span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 15 15"
                    fill="none"
                    style={{ flex: "none" }}
                  >
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
            </section>
          )}

          {/* clusters */}
          {clusters.length > 0 && (
            <section>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 14,
                }}
              >
                <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                  Research clusters
                </h2>
                <Link
                  href={`/landscape/${landscape.id}/map`}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    fontSize: 12,
                    color: "var(--accent-ink)",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  Open map{" "}
                  <svg width="11" height="11" viewBox="0 0 15 15" fill="none">
                    <path
                      d="M5 3l5 4.5L5 12"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Link>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                }}
              >
                {clusters.map((c, i) => (
                  <Link
                    key={i}
                    href={`/landscape/${landscape.id}/map`}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      border: "1px solid var(--bd)",
                      borderLeft: `3px solid ${c.color}`,
                      borderRadius: 12,
                      background: "var(--panel)",
                      padding: "16px 18px",
                      boxShadow: "var(--shadow)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 8,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</span>
                      <span
                        className="font-mono"
                        style={{ fontSize: 11, color: "var(--t3)" }}
                      >
                        {c.count} papers
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: 12.5,
                        lineHeight: 1.6,
                        color: "var(--t3)",
                        margin: 0,
                      }}
                    >
                      <ConceptText text={c.summary} concepts={concepts} landscapeId={landscape.id} />
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* timeline */}
          {timeline.length > 0 && (
            <section
              style={{
                border: "1px solid var(--bd)",
                borderRadius: 16,
                background: "var(--panel)",
                padding: "20px 22px",
                boxShadow: "var(--shadow)",
              }}
            >
              <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 20px" }}>
                Evolution of the field
              </h2>
              <div style={{ position: "relative" }}>
                <div
                  style={{
                    position: "absolute",
                    left: 6,
                    top: 6,
                    bottom: 6,
                    width: 2,
                    background:
                      "linear-gradient(#5b8def,#3fb98a,#9b7bf0,#e0613a)",
                  }}
                />
                {timeline.map((t, i) => (
                  <div
                    key={i}
                    style={{ position: "relative", padding: "0 0 18px 26px" }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 3,
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        background: "var(--panel)",
                        border: `2px solid ${t.color}`,
                      }}
                    />
                    <div
                      className="font-mono"
                      style={{ fontSize: 10, color: "var(--t3)", marginBottom: 3 }}
                    >
                      {t.when}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{t.title}</div>
                    {t.note && (
                      <div style={{ fontSize: 12, color: "var(--t3)", marginTop: 2 }}>
                        {t.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* tensions / project ideas as supplementary cards if present */}
          {Array.isArray(s.tensions) && s.tensions.length > 0 && (
            <SimpleList title="Tensions" items={s.tensions} concepts={concepts} landscapeId={landscape.id} />
          )}
          {Array.isArray(s.project_ideas) && s.project_ideas.length > 0 && (
            <SimpleList title="Project ideas" items={s.project_ideas} concepts={concepts} landscapeId={landscape.id} />
          )}
        </div>

        {/* right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {Array.isArray(s.open_problems) && s.open_problems.length > 0 && (
            <SidePanel title="Open problems">
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {s.open_problems.slice(0, 8).map((o: string, i: number) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span
                      className="font-mono"
                      style={{ fontSize: 10, color: "var(--bad)", marginTop: 2 }}
                    >
                      ◆
                    </span>
                    <span style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--t2)" }}>
                      <ConceptText text={o} concepts={concepts} landscapeId={landscape.id} />
                    </span>
                  </div>
                ))}
              </div>
            </SidePanel>
          )}

          {Array.isArray(s.prerequisites) && s.prerequisites.length > 0 && (
            <SidePanel title="Prerequisites">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {s.prerequisites.map((p: string, i: number) => (
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
                    {p}
                  </span>
                ))}
              </div>
            </SidePanel>
          )}

          {Array.isArray(s.datasets_benchmarks) && s.datasets_benchmarks.length > 0 && (
            <SidePanel title="Datasets & benchmarks">
              {s.datasets_benchmarks.slice(0, 10).map((d: any, i: number) => {
                const name = typeof d === "string" ? d : d.name || JSON.stringify(d);
                const used = typeof d === "string" ? "" : d.used || "";
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 0",
                      borderBottom: "1px solid var(--bd2)",
                    }}
                  >
                    <span
                      className="font-mono"
                      style={{ fontSize: 12, color: "var(--t2)" }}
                    >
                      {name}
                    </span>
                    {used && (
                      <span style={{ fontSize: 11, color: "var(--t3)" }}>{used}</span>
                    )}
                  </div>
                );
              })}
            </SidePanel>
          )}

          <Link
            href={`/landscape/${landscape.id}/export`}
            style={{
              all: "unset",
              cursor: "pointer",
              border: "1px solid var(--warm-bd)",
              borderRadius: 16,
              background: "var(--warm)",
              padding: "18px 20px",
              display: "flex",
              alignItems: "center",
              gap: 13,
              boxShadow: "var(--shadow)",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 15 15" fill="none">
              <path
                d="M7.5 9V2m0 7L5 6.5M7.5 9L10 6.5"
                stroke="var(--accent)"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2.5 9.5v2A1.5 1.5 0 004 13h7a1.5 1.5 0 001.5-1.5v-2"
                stroke="var(--accent)"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Export to Obsidian</div>
              <div style={{ fontSize: 11.5, color: "var(--t3)", marginTop: 2 }}>
                Markdown notes · Git-backed vault
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
              <path
                d="M5 3l5 4.5L5 12"
                stroke="var(--t3)"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>
      </div>
    </div>
    </>
  );
}

function StatCard({
  value,
  label,
  accent,
}: {
  value: string;
  label: string;
  accent?: boolean;
}) {
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
          fontSize: 30,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color: accent ? "var(--accent)" : undefined,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--t3)", marginTop: 5 }}>{label}</div>
    </div>
  );
}

function SidePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 16,
        background: "var(--panel)",
        padding: "18px 20px",
        boxShadow: "var(--shadow)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>{title}</div>
      {children}
    </section>
  );
}

function SimpleList({
  title,
  items,
  concepts,
  landscapeId,
}: {
  title: string;
  items: any[];
  concepts: Concept[];
  landscapeId: string;
}) {
  return (
    <section
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 16,
        background: "var(--panel)",
        padding: "20px 22px",
        boxShadow: "var(--shadow)",
      }}
    >
      <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 14px" }}>{title}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.slice(0, 8).map((x, i) => (
          <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
            <span style={{ color: "var(--accent-ink)", fontSize: 12, marginTop: 1 }}>▸</span>
            <span style={{ fontSize: 13, color: "var(--t2)", lineHeight: 1.55 }}>
              <ConceptText
                text={typeof x === "string" ? x : JSON.stringify(x)}
                concepts={concepts}
                landscapeId={landscapeId}
              />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
