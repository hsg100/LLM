import Link from "next/link";
import { apiGet, Concept, Landscape, LandscapePaper } from "../../../../lib/api";
import { clusterColor } from "../../../../lib/clusters";
import ConceptText from "../../../../components/concepts/ConceptText";

export const dynamic = "force-dynamic";

type Step = {
  paperId: string;
  title: string;
  why: string;
  cluster: string | null;
  mins: number;
  status: "done" | "next" | "queued";
};

export default async function ReadingPlanPage({ params }: { params: { id: string } }) {
  const [landscape, papers, concepts] = await Promise.all([
    apiGet<Landscape>(`/api/landscapes/${params.id}`),
    apiGet<LandscapePaper[]>(`/api/landscapes/${params.id}/papers`).catch(() => []),
    apiGet<Concept[]>(`/api/landscapes/${params.id}/concepts`).catch(() => []),
  ]);
  const synth = (landscape.synthesis || {}) as any;
  const clusterNameById: Record<string, string> = {};
  (synth.clusters ?? []).forEach((c: any) => {
    if (c.id) clusterNameById[c.id] = c.name;
    if (c.name) clusterNameById[c.name] = c.name;
  });

  let raw: any[] = Array.isArray(synth.reading_path) ? synth.reading_path : [];
  if (raw.length === 0) {
    raw = papers
      .filter((p) => p.reading_order !== null && p.reading_order !== undefined)
      .sort((a, b) => (a.reading_order || 0) - (b.reading_order || 0))
      .map((p) => ({
        paper_id: p.paper.id,
        title: p.paper.title,
        why: p.rationale,
        cluster: p.cluster_id,
      }));
  }
  if (raw.length === 0) {
    raw = papers
      .filter((p) => p.category === "must-read")
      .sort((a, b) => b.score - a.score)
      .map((p) => ({
        paper_id: p.paper.id,
        title: p.paper.title,
        why: p.rationale || "Ranked must-read",
        cluster: p.cluster_id,
      }));
  }

  const steps: Step[] = raw.map((s: any, i: number) => {
    const paper = papers.find((pp) => pp.paper.id === s.paper_id);
    // Heuristic: pretend the first two steps are read; the third is "up next".
    const status: "done" | "next" | "queued" =
      i < 2 ? "done" : i === 2 ? "next" : "queued";
    // ~5 min per ~1.5k tokens — rough estimate from abstract length.
    const abstractLen = paper?.paper.abstract?.length ?? 1200;
    const mins = Math.max(15, Math.min(45, Math.round(abstractLen / 60)));
    return {
      paperId: s.paper_id,
      title: (s.title || paper?.paper.title || "Untitled").split(":")[0],
      why: s.why || "",
      cluster: s.cluster || paper?.cluster_id || null,
      mins,
      status,
    };
  });

  const completedShare = steps.length
    ? Math.round(
        (steps.filter((s) => s.status === "done").length / steps.length) * 100
      )
    : 0;
  const totalMins = steps.reduce((acc, s) => acc + s.mins, 0);

  return (
    <div
      className="fm-page"
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "32px 40px 72px",
        animation: "fm-fade .3s ease",
      }}
    >
      <h1
        style={{
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          margin: "0 0 7px",
        }}
      >
        Reading plan
      </h1>
      <p style={{ fontSize: 13, color: "var(--t3)", margin: "0 0 20px" }}>
        A dependency-ordered path through the field. ~
        {Math.floor(totalMins / 60)}h {totalMins % 60}m total ·{" "}
        {steps.filter((s) => s.status === "done").length} of {steps.length} complete.
      </p>

      {steps.length === 0 ? (
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
          No reading plan yet for this landscape.
        </div>
      ) : (
        <>
          <div
            className="fm-mobile-stack"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              border: "1px solid var(--bd)",
              borderRadius: 12,
              background: "var(--panel)",
              padding: "15px 18px",
              marginBottom: 24,
              boxShadow: "var(--shadow)",
            }}
          >
            <div
              style={{
                flex: 1,
                height: 6,
                borderRadius: 3,
                background: "var(--raised)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${completedShare}%`,
                  background: "var(--good)",
                }}
              />
            </div>
            <span
              className="font-mono"
              style={{ fontSize: 12, color: "var(--good)" }}
            >
              {completedShare}%
            </span>
            <Link
              href={`/landscape/${params.id}/quiz`}
              style={{
                all: "unset",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--accent-ink)",
                padding: "7px 13px",
                border: "1px solid var(--bd)",
                borderRadius: 8,
              }}
            >
              Test recall →
            </Link>
          </div>

          <div style={{ position: "relative" }}>
            <div
              style={{
                position: "absolute",
                left: 13,
                top: 14,
                bottom: 14,
                width: 2,
                background: "var(--bd)",
              }}
            />
            {steps.map((s, i) => {
              const clColor = clusterColor(s.cluster);
              const clName = (s.cluster && clusterNameById[s.cluster]) || s.cluster || "—";
              const badgeText =
                s.status === "done" ? "Done" : s.status === "next" ? "Up next" : "Queued";
              const badgeFg =
                s.status === "done"
                  ? "var(--good)"
                  : s.status === "next"
                  ? "var(--accent-ink)"
                  : "var(--t3)";
              const badgeBg =
                s.status === "done"
                  ? "var(--good-bg)"
                  : s.status === "next"
                  ? "var(--accent-bg)"
                  : "var(--raised)";
              return (
                <div
                  key={i}
                  style={{
                    position: "relative",
                    display: "flex",
                    gap: 18,
                    paddingBottom: 14,
                  }}
                >
                  <span
                    style={{
                      position: "relative",
                      zIndex: 1,
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: s.status === "done" ? clColor : "var(--bg)",
                      border: `2px solid ${clColor}`,
                      marginTop: 16,
                      flex: "none",
                    }}
                  />
                  <Link
                    href={`/paper/${s.paperId}`}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      flex: 1,
                      border: "1px solid var(--bd)",
                      borderRadius: 12,
                      background: "var(--panel)",
                      padding: "15px 18px",
                      boxShadow: "var(--shadow)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 7,
                      }}
                    >
                      <span
                        className="font-mono"
                        style={{ fontSize: 12, color: "var(--t3)" }}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span
                        style={{ fontSize: 14, fontWeight: 600, flex: 1 }}
                      >
                        {s.title}
                      </span>
                      <span
                        style={{
                          fontSize: 10.5,
                          padding: "3px 10px",
                          borderRadius: 999,
                          color: badgeFg,
                          background: badgeBg,
                        }}
                      >
                        {badgeText}
                      </span>
                    </div>
                    {s.why && (
                      <div
                        style={{
                          fontSize: 12.5,
                          color: "var(--t3)",
                          marginBottom: 10,
                          paddingLeft: 24,
                        }}
                      >
                        <ConceptText text={s.why} concepts={concepts} landscapeId={params.id} />
                      </div>
                    )}
                    <div
                      className="font-mono"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        paddingLeft: 24,
                        fontSize: 11,
                        color: "var(--t4)",
                      }}
                    >
                      <span
                        style={{ display: "flex", alignItems: "center", gap: 5 }}
                      >
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: clColor,
                          }}
                        />
                        {clName}
                      </span>
                      <span>~{s.mins} min</span>
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
