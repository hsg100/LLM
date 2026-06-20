"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, Landscape, LandscapePaper } from "../../../../lib/api";

type Settings = {
  obsidian_export_repo_path: string;
  obsidian_export_auto_push: boolean;
};

type FileEntry = { path: string; st: "added" | "changed" | "unchanged" };

type ExportResult = {
  files: string[];
  commit_sha: string | null;
  pushed: boolean;
};

export default function ExportPage({ params }: { params: { id: string } }) {
  const [landscape, setLandscape] = useState<Landscape | null>(null);
  const [papers, setPapers] = useState<LandscapePaper[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pushOn, setPushOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadErr(null);
    Promise.all([
      apiGet<Landscape>(`/api/landscapes/${params.id}`, undefined, 10000),
      apiGet<LandscapePaper[]>(`/api/landscapes/${params.id}/papers`, undefined, 10000).catch(() => []),
      apiGet<Settings>("/api/settings", undefined, 8000).catch(() => null),
    ])
      .then(([l, p, s]) => {
        setLandscape(l);
        setPapers(p);
        if (s) {
          setSettings(s);
          setPushOn(!!s.obsidian_export_auto_push);
        }
      })
      .catch((e: any) => setLoadErr(e.message || "Failed to load export preview"))
      .finally(() => setLoading(false));
  }, [params.id]);

  async function exportNow() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await apiPost<ExportResult>(
        `/api/landscapes/${params.id}/export/obsidian`,
        { push: pushOn },
        undefined,
        120000
      );
      setResult(res);
    } catch (e: any) {
      setErr(e.message || "export failed");
    } finally {
      setBusy(false);
    }
  }

  const slug = (landscape?.topic || "landscape")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const previewFiles: FileEntry[] = result
    ? result.files.map((path) => ({ path, st: "added" }))
    : [
        { path: `Landscapes/${slug}.md`, st: "changed" },
        ...papers.slice(0, 3).map(
          (p) =>
            ({
              path: `Papers/${slug}/${slugify(p.paper.title)}.md`,
              st: "added",
            } as FileEntry)
        ),
        ...(papers.length > 3
          ? [
              {
                path: `Papers/${slug}/+${papers.length - 3} more papers`,
                st: "added",
              } as FileEntry,
            ]
          : []),
        { path: `Reading Plans/${slug}.md`, st: "added" },
        { path: `Open Questions/${slug}.md`, st: "changed" },
        { path: `Project Ideas/${slug}.md`, st: "unchanged" },
        { path: `Flashcards/${slug}.md`, st: "added" },
        { path: `Exports/${slug}-quiz.md`, st: "added" },
      ];

  const changed = previewFiles.filter((f) => f.st !== "unchanged").length;

  return (
    <div
      className="fm-page"
      style={{
        maxWidth: 1060,
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
        Export to Obsidian
      </h1>
      <p style={{ fontSize: 13, color: "var(--t3)", margin: "0 0 24px" }}>
        Renders linked markdown into your Git-backed research vault. Only changed
        files are written (SHA-256 content hash), then committed.
      </p>

      {loadErr && (
        <div
          style={{
            fontSize: 12,
            color: "var(--bad)",
            background: "rgba(207,77,111,.10)",
            border: "1px solid var(--bad)",
            borderRadius: 12,
            padding: "10px 14px",
            marginBottom: 18,
          }}
        >
          {loadErr}
        </div>
      )}

      <div
        className="fm-mobile-grid-one"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          gap: 22,
          alignItems: "start",
        }}
      >
        <div
          style={{
            border: "1px solid var(--bd)",
            borderRadius: 16,
            background: "var(--panel)",
            overflow: "hidden",
            boxShadow: "var(--shadow)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "13px 18px",
              borderBottom: "1px solid var(--bd)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
              <path
                d="M1.5 4a1 1 0 011-1h3l1.2 1.4H12a1 1 0 011 1v6a1 1 0 01-1 1H2.5a1 1 0 01-1-1V4z"
                stroke="var(--t3)"
                strokeWidth="1.2"
              />
            </svg>
            <span className="font-mono" style={{ fontSize: 12, color: "var(--t2)" }}>
              FieldMap Research/
            </span>
            <span
              className="font-mono"
              style={{ marginLeft: "auto", fontSize: 10, color: "var(--t4)" }}
            >
              {loading ? "loading preview" : `${previewFiles.length} files · ${changed} ${result ? "written" : "to write"}`}
            </span>
          </div>

          <div style={{ padding: "8px 0" }}>
            {previewFiles.map((f, i) => (
              <div
                key={f.path + i}
                className="font-mono"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "9px 18px 9px 30px",
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    color:
                      f.st === "added"
                        ? "var(--good)"
                        : f.st === "changed"
                        ? "var(--warn)"
                        : "var(--t4)",
                    width: 10,
                  }}
                >
                  {f.st === "added" ? "+" : f.st === "changed" ? "~" : "·"}
                </span>
                <span style={{ color: "var(--t2)", flex: 1 }}>{f.path}</span>
                <span
                  style={{
                    fontSize: 10,
                    color:
                      f.st === "added"
                        ? "var(--good)"
                        : f.st === "changed"
                        ? "var(--warn)"
                        : "var(--t4)",
                  }}
                >
                  {f.st}
                </span>
              </div>
            ))}
          </div>

          <div
            style={{
              borderTop: "1px solid var(--bd)",
              padding: "13px 18px",
              background: "var(--raised)",
            }}
          >
            <div
              className="font-mono"
              style={{
                fontSize: 11,
                color: "var(--t3)",
                lineHeight: 1.7,
              }}
            >
              <div>
                <span style={{ color: "var(--t4)" }}>$</span> git add -A &amp;&amp; git
                commit -m &quot;fieldmap: {landscape?.topic ?? slug} landscape&quot;
              </div>
              {result ? (
                <div style={{ color: "var(--good)" }}>
                  [main {result.commit_sha?.slice(0, 7) ?? "—"}] {result.files.length}{" "}
                  files changed
                  {result.pushed ? " · pushed" : ""}
                </div>
              ) : (
                <div style={{ color: "var(--t4)" }}>
                  preview · run export to commit
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="Target vault">
            <div
              className="font-mono"
              style={{
                fontSize: 11.5,
                color: "var(--t2)",
                background: "var(--raised)",
                border: "1px solid var(--bd)",
                borderRadius: 8,
                padding: "10px 12px",
                marginBottom: 12,
                wordBreak: "break-all",
              }}
            >
              {settings?.obsidian_export_repo_path ?? (loading ? "(loading…)" : "(settings unavailable)")}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                git clean
              </span>
              <span style={{ fontSize: 11, color: "var(--t4)" }}>·</span>
              <span style={{ fontSize: 11, color: "var(--t3)" }}>branch main</span>
            </div>
          </Card>

          <Card>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                Auto-push to remote
              </span>
              <button
                onClick={() => setPushOn((v) => !v)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  width: 38,
                  height: 22,
                  borderRadius: 999,
                  background: pushOn ? "var(--accent)" : "var(--bd)",
                  position: "relative",
                  transition: "background .2s",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: pushOn ? 18 : 2,
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "#fff",
                    transition: "left .2s",
                  }}
                />
              </button>
            </div>
            <div
              className="font-mono"
              style={{ fontSize: 11.5, color: "var(--t3)" }}
            >
              {pushOn ? "origin · enabled" : "local commit only"}
            </div>
          </Card>

          <div
            style={{
              border: "1px solid var(--warm-bd)",
              borderRadius: 16,
              background: "var(--warm)",
              padding: "15px 17px",
              display: "flex",
              gap: 10,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 15 15"
              fill="none"
              style={{ flex: "none", marginTop: 1 }}
            >
              <path
                d="M7.5 1.5l6 3v3c0 3.5-2.5 5.5-6 6.5-3.5-1-6-3-6-6.5v-3l6-3z"
                stroke="var(--warn)"
                strokeWidth="1.1"
              />
            </svg>
            <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "var(--t2)" }}>
              Writes to a <span style={{ color: "var(--warn)" }}>separate</span>{" "}
              research vault — your main Obsidian vault is never touched.
            </div>
          </div>

          {err && (
            <div
              style={{
                fontSize: 12,
                color: "var(--bad)",
                background: "rgba(207,77,111,.10)",
                border: "1px solid var(--bad)",
                borderRadius: 12,
                padding: "10px 14px",
              }}
            >
              {err}
            </div>
          )}

          {result && (
            <div
              style={{
                fontSize: 12,
                color: "var(--good)",
                background: "var(--good-bg)",
                border: "1px solid var(--good)",
                borderRadius: 12,
                padding: "10px 14px",
              }}
            >
              Wrote {result.files.length} file{result.files.length === 1 ? "" : "s"}
              {result.commit_sha ? ` · commit ${result.commit_sha.slice(0, 7)}` : " · no changes"}
              {result.pushed ? " · pushed" : ""}
            </div>
          )}

          <button
            onClick={exportNow}
            disabled={busy}
            style={{
              all: "unset",
              cursor: busy ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: 14,
              borderRadius: 12,
              background: "var(--accent)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              boxShadow: "0 4px 16px rgba(224,97,58,.28)",
              opacity: busy ? 0.7 : 1,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path
                d="M7.5 9V2m0 7L5 6.5M7.5 9L10 6.5"
                stroke="#fff"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2.5 9.5v2A1.5 1.5 0 004 13h7a1.5 1.5 0 001.5-1.5v-2"
                stroke="#fff"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            {busy
              ? "Exporting…"
              : `Export & commit ${previewFiles.length} files`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 16,
        background: "var(--panel)",
        padding: "18px 20px",
        boxShadow: "var(--shadow)",
      }}
    >
      {title && (
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}
