import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import {
  catalogHash,
  getLesson,
  getTopic,
  orderedTopics,
} from "../../../../lib/curriculum/catalog.server";
import { LessonRuntime } from "../../../../components/learn/LessonRuntime";

/**
 * Interactive-lesson page, Phase 2 scope: server-rendered narrative blocks
 * from the committed catalogue (markdown with HTML disabled — defence in
 * depth on top of the compiler's raw-HTML rejection), demo placeholders with
 * their required plain-text fallbacks (implementations are Phase 3), sources,
 * and the client checkpoint/resume runtime with minimal props.
 */

export function generateStaticParams() {
  const params: { topic: string; lesson: string }[] = [];
  for (const t of orderedTopics()) {
    if (t.status !== "active") continue;
    for (const lesson of t.lessons) params.push({ topic: t.slug, lesson });
  }
  return params;
}

export default function LessonPage({ params }: { params: { topic: string; lesson: string } }) {
  const topic = getTopic(params.topic);
  const lesson = getLesson(params.lesson);
  if (!topic || !lesson || lesson.topic !== topic.slug) notFound();

  return (
    <div
      className="fm-page"
      style={{ maxWidth: 760, margin: "0 auto", padding: "32px 40px 72px", animation: "fm-fade .3s ease" }}
    >
      <div className="font-mono" style={{ fontSize: 10, color: "var(--t4)", letterSpacing: "0.14em", marginBottom: 8 }}>
        <Link href="/learn" style={{ color: "var(--t4)", textDecoration: "none" }}>
          LEARN
        </Link>{" "}
        /{" "}
        <Link href={`/learn/${topic.slug}`} style={{ color: "var(--t4)", textDecoration: "none" }}>
          {topic.title.toUpperCase()}
        </Link>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 6px" }}>
        {lesson.title}
      </h1>
      <div className="font-mono" style={{ fontSize: 11, color: "var(--t4)", marginBottom: 4 }}>
        ~{lesson.duration_minutes} min · lesson v{lesson.version}
      </div>

      <LessonRuntime
        lessonSlug={lesson.slug}
        lessonVersion={lesson.version}
        catalogHash={catalogHash}
        blockIds={lesson.blocks.map((b) => b.id)}
        checkpointSlug={lesson.checkpoint.slug}
        passScore={lesson.checkpoint.pass_score}
        questions={lesson.checkpoint.questions.map((q) => ({
          id: q.id,
          prompt: q.prompt,
          options: q.options,
        }))}
      />

      {lesson.blocks.map((block) => (
        <section key={block.id} id={`block-${block.id}`} style={{ marginBottom: 26, scrollMarginTop: 70 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em", margin: "0 0 10px" }}>
            {block.heading}
          </h2>
          <div className="fm-lesson-prose" style={{ fontSize: 14, lineHeight: 1.75, color: "var(--t2)" }}>
            <ReactMarkdown skipHtml>{block.markdown}</ReactMarkdown>
          </div>
        </section>
      ))}

      {lesson.demos.length > 0 && (
        <section style={{ marginBottom: 26 }}>
          {lesson.demos.map((demo) => (
            <div
              key={demo}
              role="note"
              style={{
                border: "1px dashed var(--bd)",
                borderRadius: 12,
                background: "var(--panel)",
                padding: "14px 16px",
                fontSize: 13,
                color: "var(--t3)",
                lineHeight: 1.6,
              }}
            >
              <div className="font-mono" style={{ fontSize: 9.5, letterSpacing: "0.12em", color: "var(--t4)", marginBottom: 6 }}>
                INTERACTIVE DEMO · {demo.toUpperCase()} · ARRIVES WITH PHASE 3
              </div>
              {lesson.demo_fallbacks[demo]}
            </div>
          ))}
        </section>
      )}

      <section style={{ marginBottom: 8 }}>
        <div className="font-mono" style={{ fontSize: 10, color: "var(--t4)", letterSpacing: "0.14em", margin: "0 0 8px" }}>
          SOURCES &amp; FURTHER READING
        </div>
        <ul style={{ fontSize: 12.5, paddingLeft: 20, lineHeight: 1.8, color: "var(--t3)" }}>
          {lesson.sources.map((src) => (
            <li key={src.id}>
              <a href={src.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent-ink)" }}>
                {src.title ?? src.url}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
