import Link from "next/link";
import { apiGet, Landscape } from "../../lib/api";
import { DeleteLandscapeButton } from "../../components/landscapes/DeleteLandscapeButton";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  ready: "var(--good)",
  done: "var(--good)",
  running: "var(--accent)",
  queued: "var(--accent)",
  failed: "var(--bad)",
};

export default async function LandscapesList() {
  let rows: Landscape[] = [];
  let err: string | null = null;
  try {
    rows = await apiGet<Landscape[]>("/api/landscapes");
  } catch (e: any) {
    err = e?.message || String(e);
  }

  return (
    <div
      className="fm-page"
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "32px 40px 72px",
        animation: "fm-fade .3s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 22,
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: "0 0 7px",
            }}
          >
            Landscapes
          </h1>
          <p style={{ fontSize: 13, color: "var(--t3)", margin: 0 }}>
            Every research field you&apos;ve mapped. Open one to drill into its
            papers, plan, and review.
          </p>
        </div>
        <Link
          href="/search"
          style={{
            all: "unset",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 15px",
            borderRadius: 9,
            background: "var(--accent)",
            color: "#fff",
            fontSize: 12.5,
            fontWeight: 600,
            boxShadow: "0 2px 10px rgba(224,97,58,.28)",
          }}
        >
          + New landscape
        </Link>
      </div>

      {err && (
        <div
          style={{
            fontSize: 13,
            color: "var(--bad)",
            background: "rgba(207,77,111,.10)",
            border: "1px solid var(--bad)",
            borderRadius: 12,
            padding: "12px 16px",
            marginBottom: 16,
          }}
        >
          Couldn&apos;t reach the API: <span className="font-mono">{err}</span>
        </div>
      )}

      {rows.length === 0 && !err ? (
        <div
          style={{
            border: "1px dashed var(--bd)",
            borderRadius: 14,
            background: "var(--panel)",
            padding: "26px",
            textAlign: "center",
            color: "var(--t3)",
          }}
        >
          No landscapes yet. <Link href="/search">Start one →</Link>
        </div>
      ) : (
        <div
          style={{
            border: "1px solid var(--bd)",
            borderRadius: 14,
            background: "var(--panel)",
            overflow: "hidden",
            boxShadow: "var(--shadow)",
          }}
        >
          {rows.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 18px",
                borderBottom: "1px solid var(--bd2)",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: STATUS_COLOR[r.status] ?? "var(--t4)",
                }}
              />
              <Link
                href={`/landscape/${r.id}`}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{r.topic}</div>
                <div
                  className="font-mono"
                  style={{ fontSize: 11, color: "var(--t4)", marginTop: 2 }}
                >
                  {r.status} · created {new Date(r.created_at).toLocaleDateString()}
                </div>
              </Link>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  fontSize: 11.5,
                  color: "var(--t3)",
                }}
              >
                <SmallLink href={`/landscape/${r.id}/papers`}>Papers</SmallLink>
                <SmallLink href={`/landscape/${r.id}/map`}>Map</SmallLink>
                <SmallLink href={`/landscape/${r.id}/quiz`}>Quiz</SmallLink>
                <SmallLink href={`/landscape/${r.id}/flashcards`}>Cards</SmallLink>
                <DeleteLandscapeButton id={r.id} topic={r.topic} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SmallLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      style={{
        all: "unset",
        cursor: "pointer",
        padding: "5px 10px",
        borderRadius: 7,
        border: "1px solid var(--bd)",
        fontSize: 11.5,
        color: "var(--t2)",
        background: "var(--raised)",
      }}
    >
      {children}
    </Link>
  );
}
