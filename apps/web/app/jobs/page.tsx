import Link from "next/link";
import { apiGet, JobSummary } from "../../lib/api";

export const dynamic = "force-dynamic";

const TERMINAL: Record<string, string> = { done: "var(--good)", ready: "var(--good)", failed: "var(--bad)", cancelled: "var(--t4)" };

function color(stage: string): string {
  if (stage in TERMINAL) return TERMINAL[stage];
  return "var(--accent)"; // running / queued / mid-pipeline
}

export default async function JobsIndex() {
  let rows: JobSummary[] = [];
  let err: string | null = null;
  try {
    rows = await apiGet<JobSummary[]>("/api/jobs");
  } catch (e: any) {
    err = e?.message || String(e);
  }

  return (
    <div className="fm-page" style={{ maxWidth: 960, margin: "0 auto", padding: "32px 40px 72px", animation: "fm-fade .3s ease" }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 7px" }}>Job monitor</h1>
        <p style={{ fontSize: 13, color: "var(--t3)", margin: 0 }}>
          Every pipeline run, newest first. Open one to watch live progress and events.
        </p>
      </div>

      {err && (
        <div style={{ fontSize: 13, color: "var(--bad)", background: "rgba(207,77,111,.10)", border: "1px solid var(--bad)", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
          {err}
        </div>
      )}

      {!err && rows.length === 0 ? (
        <div style={{ border: "1px dashed var(--bd)", borderRadius: 12, background: "var(--panel)", padding: "22px 24px", color: "var(--t3)", fontSize: 13 }}>
          No jobs yet. <Link href="/search" style={{ color: "var(--accent-ink)", fontWeight: 600 }}>Start a landscape →</Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {rows.map((j) => {
            const c = color(j.stage);
            const pct = Math.round((j.progress || 0) * 100);
            return (
              <Link
                key={j.id}
                href={`/jobs/${j.id}?landscape=${j.landscape_id}`}
                style={{ all: "unset", cursor: "pointer", display: "block", border: "1px solid var(--bd)", borderRadius: 12, background: "var(--panel)", padding: "14px 16px", boxShadow: "var(--shadow)" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, flex: "none" }} />
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {j.topic || j.landscape_id}
                  </span>
                  <span className="font-mono" style={{ fontSize: 10.5, color: c, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {j.stage}
                  </span>
                  <span className="font-mono" style={{ fontSize: 11, color: "var(--t4)", width: 38, textAlign: "right" }}>{pct}%</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: "var(--raised)", overflow: "hidden", marginTop: 10 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: c }} />
                </div>
                {j.error && <div style={{ fontSize: 11.5, color: "var(--bad)", marginTop: 8 }}>{j.error}</div>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
