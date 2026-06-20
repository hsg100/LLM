import { apiGet } from "../../lib/api";

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
};

export default async function SettingsPage() {
  let s: Settings | null = null;
  try {
    s = await apiGet<Settings>("/api/settings");
  } catch {
    s = null;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Settings</h1>
      <p className="text-sm text-neutral-600 mb-6">
        Settings are loaded from the API container&apos;s <code>.env</code>. Update the file and
        restart the API to change them.
      </p>

      {!s ? (
        <div className="text-sm text-red-700">API not reachable.</div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm bg-white border border-neutral-200 rounded-md p-4">
          <dt className="text-neutral-500">LLM provider</dt>
          <dd>
            {s.llm_provider}{" "}
            <span className="text-xs text-neutral-500">
              ({s.has_openai_key ? "openai✓ " : ""}{s.has_deepseek_key ? "deepseek✓ " : ""}
              {s.has_anthropic_key ? "anthropic✓ " : ""}
              {!s.has_openai_key && !s.has_deepseek_key && !s.has_anthropic_key && "no keys — stub mode"})
            </span>
          </dd>

          <dt className="text-neutral-500">Fast model</dt>
          <dd>{s.llm_model_fast}</dd>
          <dt className="text-neutral-500">Strong model</dt>
          <dd>{s.llm_model_strong}</dd>

          <dt className="text-neutral-500">Embedding</dt>
          <dd>
            {s.embedding_provider} · {s.embedding_model} ({s.embedding_dim}-d)
          </dd>

          <dt className="text-neutral-500">Obsidian repo path</dt>
          <dd className="font-mono text-xs">{s.obsidian_export_repo_path}</dd>
          <dt className="text-neutral-500">Auto-push</dt>
          <dd>{s.obsidian_export_auto_push ? "on" : "off"}</dd>

          <dt className="text-neutral-500">Max papers / landscape</dt>
          <dd>{s.max_papers_per_landscape}</dd>
        </dl>
      )}
    </div>
  );
}
