import Link from "next/link";
import { notFound } from "next/navigation";
import { getLesson, getTopic, orderedTopics } from "../../../lib/curriculum/catalog.server";

/** Topic overview, rendered server-side from the committed catalogue. */

export function generateStaticParams() {
  return orderedTopics()
    .filter((t) => t.status === "active")
    .map((t) => ({ topic: t.slug }));
}

export default function TopicPage({ params }: { params: { topic: string } }) {
  const topic = getTopic(params.topic);
  if (!topic || topic.status !== "active") notFound();

  const lessons = topic.lessons
    .map((slug) => getLesson(slug))
    .filter((l): l is NonNullable<typeof l> => l !== null);

  return (
    <div
      className="fm-page fm-learn-page"
      style={{ maxWidth: 960, margin: "0 auto", padding: "32px 40px 72px" }}
    >
      <div className="font-mono" style={{ fontSize: 10, color: "var(--t4)", letterSpacing: "0.14em", marginBottom: 8 }}>
        <Link href="/learn" style={{ color: "var(--t4)", textDecoration: "none" }}>
          LEARN
        </Link>{" "}
        / TOPIC
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 7px" }}>
        {topic.title}
      </h1>
      <p style={{ fontSize: 13, color: "var(--t3)", margin: "0 0 18px", maxWidth: 640 }}>{topic.summary}</p>

      {topic.prerequisites.length > 0 && (
        <p style={{ fontSize: 12.5, color: "var(--t3)", margin: "0 0 18px" }}>
          Builds on:{" "}
          {topic.prerequisites.map((pre, i) => {
            const preTopic = getTopic(pre);
            const label = preTopic?.title ?? pre;
            return (
              <span key={pre}>
                {i > 0 && ", "}
                {preTopic?.status === "active" ? (
                  <Link href={`/learn/${pre}`} style={{ color: "var(--accent-ink)", fontWeight: 600 }}>
                    {label}
                  </Link>
                ) : (
                  <span title="Planned — not yet open">{label} (planned)</span>
                )}
              </span>
            );
          })}
          . Recommended, not enforced — you can proceed regardless.
        </p>
      )}

      <SectionLabel>YOU&apos;LL BE ABLE TO</SectionLabel>
      <ul style={{ fontSize: 13, color: "var(--t2)", margin: "0 0 24px", paddingLeft: 20, lineHeight: 1.7 }}>
        {topic.learning_objectives.map((o) => (
          <li key={o}>{o}</li>
        ))}
      </ul>

      <SectionLabel>LESSONS</SectionLabel>
      <div
        style={{
          border: "1px solid var(--bd)",
          borderRadius: 14,
          background: "var(--panel)",
          overflow: "hidden",
          boxShadow: "var(--shadow)",
        }}
      >
        {lessons.map((l, i) => (
          <Link
            key={l.slug}
            href={`/learn/${topic.slug}/${l.slug}`}
            className="fm-learn-card-link"
            style={{
              cursor: "pointer",
              color: "inherit",
              textDecoration: "none",
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              padding: "13px 18px",
              borderBottom: i === lessons.length - 1 ? "none" : "1px solid var(--bd2)",
            }}
          >
            <span className="font-mono" style={{ flex: "none", width: 22, fontSize: 11, color: "var(--t4)" }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 500 }}>{l.title}</span>
              <span className="font-mono" style={{ display: "block", fontSize: 10.5, color: "var(--t4)", marginTop: 2 }}>
                ~{l.duration_minutes} min · checkpoint · v{l.version}
              </span>
            </span>
            <span style={{ flex: "none", fontSize: 12, color: "var(--accent-ink)", fontWeight: 600 }}>
              Open →
            </span>
          </Link>
        ))}
      </div>
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
