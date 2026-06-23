"use client";

import { useState } from "react";
import { updateSettings } from "../../lib/api";

type Initial = {
  llm_provider: string;
  llm_model_fast: string;
  llm_model_strong: string;
  max_papers_per_landscape: number;
  obsidian_export_auto_push: boolean;
  obsidian_auto_export: boolean;
  editable_fields: string[];
};

const labelStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--t3)",
  marginBottom: 5,
  display: "block",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 13.5,
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid var(--bd)",
  background: "var(--bg)",
  color: "var(--t1)",
};

export default function SettingsForm({ initial }: { initial: Initial }) {
  const [provider, setProvider] = useState(initial.llm_provider);
  const [fast, setFast] = useState(initial.llm_model_fast);
  const [strong, setStrong] = useState(initial.llm_model_strong);
  const [maxPapers, setMaxPapers] = useState(initial.max_papers_per_landscape);
  const [autoPush, setAutoPush] = useState(initial.obsidian_export_auto_push);
  const [autoExport, setAutoExport] = useState(initial.obsidian_auto_export);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function onSave() {
    setSaving(true);
    setMsg(null);
    try {
      await updateSettings({
        llm_provider: provider,
        llm_model_fast: fast,
        llm_model_strong: strong,
        max_papers_per_landscape: Number(maxPapers),
        obsidian_export_auto_push: autoPush,
        obsidian_auto_export: autoExport,
      });
      setMsg({ kind: "ok", text: "Saved — applies to new runs without a redeploy." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid var(--bd)",
        borderRadius: 16,
        background: "var(--panel)",
        padding: "20px 22px",
        marginBottom: 22,
        boxShadow: "var(--shadow)",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
        Runtime settings
      </div>
      <p style={{ fontSize: 12, color: "var(--t3)", margin: "0 0 16px" }}>
        Editable without redeploy. API keys and embedding settings stay in{" "}
        <span className="font-mono">.env</span>.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label style={labelStyle}>LLM provider</label>
          <select style={inputStyle} value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="deepseek">deepseek</option>
            <option value="openai">openai</option>
            <option value="anthropic">anthropic</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Max papers per landscape</label>
          <input
            style={inputStyle}
            type="number"
            min={1}
            max={500}
            value={maxPapers}
            onChange={(e) => setMaxPapers(Number(e.target.value))}
          />
        </div>
        <div>
          <label style={labelStyle}>Fast model (cheap / simple tasks)</label>
          <input style={inputStyle} value={fast} onChange={(e) => setFast(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Strong model (hard reasoning)</label>
          <input style={inputStyle} value={strong} onChange={(e) => setStrong(e.target.value)} />
        </div>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={autoExport}
          onChange={(e) => setAutoExport(e.target.checked)}
        />
        Auto-export to Obsidian when a landscape finishes
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={autoPush}
          onChange={(e) => setAutoPush(e.target.checked)}
        />
        Auto-push Obsidian exports to the configured git remote
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          style={{
            fontSize: 13,
            fontWeight: 600,
            padding: "8px 16px",
            borderRadius: 9,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {msg && (
          <span style={{ fontSize: 12.5, color: msg.kind === "ok" ? "var(--good)" : "var(--bad)" }}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
