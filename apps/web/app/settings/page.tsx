import { apiGet } from "../../lib/api";
import SettingsForm from "../../components/settings/SettingsForm";

export const dynamic = "force-dynamic";

type Settings = {
  llm_provider: string;
  llm_model_fast: string;
  llm_model_strong: string;
  embedding_provider: string;
  embedding_model: string;
  embedding_dim: number;
  obsidian_export_repo_path: string;
  obsidian_export_auto_push: boolean;
  max_papers_per_landscape: number;
  has_openai_key: boolean;
  has_deepseek_key: boolean;
  has_anthropic_key: boolean;
  editable_fields?: string[];
};

type Embed = {
  ok: boolean;
  provider?: string;
  model?: string;
  dimension?: number;
  error?: string;
};

export default async function SettingsPage() {
  let s: Settings | null = null;
  let embed: Embed | null = null;
  try {
    s = await apiGet<Settings>("/api/settings", undefined, 8000);
  } catch {
    s = null;
  }
  try {
    embed = await apiGet<Embed>("/ready/embeddings", undefined, 6000);
  } catch {
    embed = null;
  }

  if (!s) {
    return (
      <div style={{ padding: "32px 40px", maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22 }}>Settings &amp; readiness</h1>
        <div
          style={{
            fontSize: 13,
            color: "var(--bad)",
            background: "rgba(207,77,111,.10)",
            border: "1px solid var(--bad)",
            borderRadius: 12,
            padding: "12px 16px",
            marginTop: 16,
          }}
        >
          API not reachable.
        </div>
      </div>
    );
  }

  const hasAnyKey = s.has_openai_key || s.has_deepseek_key || s.has_anthropic_key;
  const embedReady = !!embed?.ok;
  const ready = hasAnyKey && embedReady;

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
        Settings &amp; readiness
      </h1>
      <p style={{ fontSize: 13, color: "var(--t3)", margin: "0 0 24px" }}>
        Runtime view of providers and the pipeline. Editable settings save below;
        secrets and embedding config live in{" "}
        <span className="font-mono" style={{ color: "var(--t2)" }}>.env</span>.
      </p>

      <SettingsForm
        initial={{
          llm_provider: s.llm_provider,
          llm_model_fast: s.llm_model_fast,
          llm_model_strong: s.llm_model_strong,
          max_papers_per_landscape: s.max_papers_per_landscape,
          obsidian_export_auto_push: s.obsidian_export_auto_push,
          editable_fields: s.editable_fields ?? [],
        }}
      />

      <div
        style={{
          border: "1px solid var(--bd)",
          borderRadius: 16,
          background: "var(--warm)",
          padding: "20px 22px",
          marginBottom: 22,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            marginBottom: 18,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: ready ? "var(--good-bg)" : "var(--accent-bg)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {ready ? (
              <svg width="13" height="13" viewBox="0 0 15 15">
                <path
                  d="M3 8l3 3 6-7"
                  stroke="var(--good)"
                  strokeWidth="1.7"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 15 15">
                <path
                  d="M7.5 4v5M7.5 11v.5"
                  stroke="var(--warn)"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            {ready ? "Pipeline ready" : "Pipeline partially configured"}
          </span>
          <span style={{ fontSize: 12, color: "var(--t3)" }}>
            — {ready ? "all required services connected" : "see chips below"}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <ReadyChip
            ok={hasAnyKey}
            label={
              hasAnyKey
                ? "LLM provider connected"
                : "No LLM keys — stub mode"
            }
            optional={false}
          />
          <ReadyChip
            ok={embedReady}
            label={
              embed?.ok
                ? `Embeddings ready (${embed.provider})`
                : embed?.error
                ? `Embeddings: ${embed.error.slice(0, 40)}`
                : "Embeddings not ready"
            }
            optional={false}
          />
          <ReadyChip
            ok
            label={`Vault: ${s.obsidian_export_repo_path.split("/").slice(-2).join("/")}`}
            optional={false}
          />
          <ReadyChip
            ok={s.has_anthropic_key}
            optional={!s.has_anthropic_key}
            label={
              s.has_anthropic_key
                ? "Anthropic key set"
                : "Anthropic key not set"
            }
          />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionCard label="LANGUAGE MODEL">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field
              label="Provider"
              value={
                <>
                  {s.llm_provider}{" "}
                  <span
                    style={{
                      fontSize: 11,
                      color: hasAnyKey ? "var(--good)" : "var(--warn)",
                    }}
                  >
                    ● {hasAnyKey ? "connected" : "no key"}
                  </span>
                </>
              }
            />
            <Field
              label="Models"
              value={
                <span className="font-mono" style={{ fontSize: 12, color: "var(--t2)" }}>
                  {s.llm_model_fast}{" "}
                  <span style={{ color: "var(--t4)" }}>/</span>{" "}
                  {s.llm_model_strong}
                </span>
              }
            />
          </div>
        </SectionCard>

        <SectionCard label="EMBEDDINGS">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            <Field label="Model" value={<Mono>{s.embedding_model}</Mono>} />
            <Field label="Dimension" value={<Mono>{s.embedding_dim}</Mono>} />
            <Field label="Provider" value={<span style={{ fontSize: 13 }}>{s.embedding_provider}</span>} />
          </div>
        </SectionCard>

        <SectionCard label="PIPELINE DEFAULTS">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            <Field
              label="Max papers / landscape"
              value={<Mono>{s.max_papers_per_landscape}</Mono>}
            />
            <Field label="Sources" value={<span style={{ fontSize: 13 }}>arXiv</span>} />
            <Field
              label="Auto-push exports"
              value={
                <span style={{ fontSize: 13, color: s.obsidian_export_auto_push ? "var(--good)" : "var(--t3)" }}>
                  {s.obsidian_export_auto_push ? "on" : "off"}
                </span>
              }
            />
          </div>
        </SectionCard>

        <SectionCard label="OBSIDIAN EXPORT">
          <Field
            label="Vault path"
            value={
              <Mono style={{ wordBreak: "break-all" }}>
                {s.obsidian_export_repo_path}
              </Mono>
            }
          />
        </SectionCard>
      </div>
    </div>
  );
}

function ReadyChip({
  ok,
  label,
  optional,
}: {
  ok: boolean;
  label: string;
  optional: boolean;
}) {
  const color = ok ? "var(--good)" : optional ? "var(--warn)" : "var(--bad)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "10px 13px",
        borderRadius: 9,
        background: "var(--panel)",
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
      <span style={{ fontSize: 12.5, color: "var(--t2)" }}>
        {label}
        {optional && (
          <span style={{ color: "var(--t4)", marginLeft: 4 }}>(optional)</span>
        )}
      </span>
    </div>
  );
}

function SectionCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
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
          fontSize: 10,
          color: "var(--t4)",
          letterSpacing: "0.1em",
          marginBottom: 13,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "var(--t3)", marginBottom: 5 }}>
        {label}
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function Mono({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="font-mono"
      style={{ fontSize: 12, color: "var(--t2)", ...style }}
    >
      {children}
    </span>
  );
}
