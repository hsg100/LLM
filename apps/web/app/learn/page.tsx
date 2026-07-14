import Link from "next/link";
import { catalogHash, curriculum, getLesson, orderedTopics } from "../../lib/curriculum/catalog.server";
import { LearnPathwayProgress } from "../../components/learn/LearnPathwayProgress";

/**
 * Learn — the LLM curriculum map, rendered server-side from the committed
 * catalogue (design §7). No api, worker or model provider is needed to read
 * this page; learner progress is layered on client-side with honest states.
 */
export default function LearnPage() {
  const topics = orderedTopics();
  const active = topics.filter((t) => t.status === "active");
  const planned = topics.filter((t) => t.status === "planned");
  const retired = topics.filter((t) => t.status === "retired");
  const lessonTopics: Record<string, string> = {};
  for (const t of active) {
    for (const slug of t.lessons) lessonTopics[slug] = getLesson(slug)?.topic ?? t.slug;
  }

  return (
    <div
      className="fm-page"
      style={{ maxWidth: 960, margin: "0 auto", padding: "32px 40px 72px", animation: "fm-fade .3s ease" }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 7px" }}>
        {curriculum.title}
      </h1>
      <p style={{ fontSize: 13, color: "var(--t3)", margin: "0 0 18px", maxWidth: 640 }}>
        A structured pathway from intuition to mechanism to the primary research. Lessons are
        readable today; interactive demonstrations arrive with the next phase.
      </p>

      <LearnPathwayProgress catalogHash={catalogHash} lessonTopics={lessonTopics} />

      <SectionLabel>OPEN TOPICS</SectionLabel>
      <div
        style={{
          border: "1px solid var(--bd)",
          borderRadius: 14,
          background: "var(--panel)",
          overflow: "hidden",
          boxShadow: "var(--shadow)",
          marginBottom: 30,
        }}
      >
        {active.map((t, i) => (
          <Link
            key={t.slug}
            href={`/learn/${t.slug}`}
            className="fm-learn-card-link"
            style={{
              cursor: "pointer",
              color: "inherit",
              textDecoration: "none",
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              padding: "13px 18px",
              borderBottom: i === active.length - 1 ? "none" : "1px solid var(--bd2)",
            }}
          >
            <span className="font-mono" style={{ flex: "none", width: 22, fontSize: 11, color: "var(--t4)" }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 500 }}>{t.title}</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--t3)", marginTop: 2 }}>
                {t.summary}
              </span>
            </span>
            <span className="font-mono" style={{ flex: "none", fontSize: 10.5, color: "var(--t4)" }}>
              {t.lessons.length} lesson{t.lessons.length === 1 ? "" : "s"} →
            </span>
          </Link>
        ))}
      </div>

      {planned.length > 0 && (
        <>
          <SectionLabel>PLANNED — NOT YET OPEN</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
            {planned.map((t) => (
              <span
                key={t.slug}
                title={t.summary}
                style={{
                  fontSize: 12,
                  color: "var(--t3)",
                  border: "1px dashed var(--bd)",
                  borderRadius: 999,
                  padding: "6px 12px",
                  background: "var(--panel)",
                }}
              >
                {t.title}
              </span>
            ))}
          </div>
        </>
      )}

      {retired.length > 0 && (
        <>
          <SectionLabel>NO LONGER OFFERED</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {retired.map((t) => (
              <span key={t.slug} style={{ fontSize: 12, color: "var(--t4)", textDecoration: "line-through" }}>
                {t.title}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono" style={{ fontSize: 10, color: "var(--t4)", letterSpacing: "0.14em", margin: "0 0 10px" }}>
      {children}
    </div>
  );
}
