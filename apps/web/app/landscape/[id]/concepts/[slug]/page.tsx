import Link from "next/link";
import { apiGet, ConceptDetail } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export default async function ConceptDetailPage({
  params,
}: {
  params: { id: string; slug: string };
}) {
  const detail = await apiGet<ConceptDetail>(
    `/api/landscapes/${params.id}/concepts/${params.slug}`
  );
  const c = detail.concept;

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
      <Link
        href={`/landscape/${params.id}`}
        style={{ fontSize: 12, color: "var(--t3)" }}
      >
        Back to landscape
      </Link>

      <header style={{ marginTop: 18, marginBottom: 24 }}>
        <div
          className="font-mono"
          style={{
            fontSize: 10,
            letterSpacing: "0.1em",
            color: "var(--accent-ink)",
            marginBottom: 8,
          }}
        >
          CONCEPT
        </div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 650,
            letterSpacing: "-0.02em",
            margin: "0 0 10px",
          }}
        >
          {c.term}
        </h1>
        {c.aliases.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {c.aliases.map((a) => (
              <span
                key={a}
                style={{
                  fontSize: 11.5,
                  padding: "4px 9px",
                  borderRadius: 999,
                  background: "var(--raised)",
                  border: "1px solid var(--bd)",
                  color: "var(--t3)",
                }}
              >
                {a}
              </span>
            ))}
          </div>
        )}
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 20 }} className="fm-mobile-grid-one">
        <main style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Panel title="Short definition">
            <p style={copyStyle}>{c.short_definition || "Pending."}</p>
          </Panel>
          <Panel title="Longer explanation">
            <p style={copyStyle}>{c.long_definition || "Pending."}</p>
          </Panel>
          <Panel title="Why it matters">
            <p style={copyStyle}>{c.why_it_matters || "Pending."}</p>
          </Panel>
          <Panel title="Source grounding">
            {detail.example_snippets.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {detail.example_snippets.map((s, i) => (
                  <blockquote
                    key={i}
                    style={{
                      margin: 0,
                      padding: "10px 12px",
                      borderLeft: "3px solid var(--accent)",
                      background: "var(--raised)",
                      color: "var(--t2)",
                      fontSize: 12.5,
                      lineHeight: 1.55,
                    }}
                  >
                    {s}
                  </blockquote>
                ))}
              </div>
            ) : (
              <p style={copyStyle}>No snippets available yet.</p>
            )}
          </Panel>
        </main>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Panel title="Confidence">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
                    width: `${Math.round(c.confidence * 100)}%`,
                    background: "var(--accent)",
                  }}
                />
              </div>
              <span className="font-mono" style={{ fontSize: 12, color: "var(--accent-ink)" }}>
                {Math.round(c.confidence * 100)}%
              </span>
            </div>
          </Panel>

          <Panel title="Related terms">
            {detail.related_concepts.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {detail.related_concepts.map((r) => (
                  <Link
                    key={r.slug}
                    href={`/landscape/${params.id}/concepts/${r.slug}`}
                    style={{
                      fontSize: 12.5,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--bd)",
                      background: "var(--raised)",
                      color: "var(--t2)",
                    }}
                  >
                    {r.term}
                  </Link>
                ))}
              </div>
            ) : (
              <p style={copyStyle}>No related concepts yet.</p>
            )}
          </Panel>

          <Panel title="Mentioned in papers">
            {detail.papers.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {detail.papers.map((p) => (
                  <Link
                    key={p.id}
                    href={`/paper/${p.id}`}
                    style={{ fontSize: 12.5, color: "var(--accent-ink)", lineHeight: 1.35 }}
                  >
                    {p.title}
                  </Link>
                ))}
              </div>
            ) : (
              <p style={copyStyle}>No paper links yet.</p>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

const copyStyle = {
  margin: 0,
  fontSize: 13.5,
  lineHeight: 1.65,
  color: "var(--t2)",
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 14,
        background: "var(--panel)",
        padding: "18px 20px",
        boxShadow: "var(--shadow)",
      }}
    >
      <h2 style={{ fontSize: 13, fontWeight: 650, margin: "0 0 12px" }}>{title}</h2>
      {children}
    </section>
  );
}
