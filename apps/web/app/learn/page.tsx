import Link from "next/link";

/**
 * Learn — the LLM curriculum map (Phase 1 foundation).
 *
 * The interactive curriculum (versioned topics, lessons, demos, checkpoints)
 * arrives in Phase 2/3 of the recovery plan. Until then this page states the
 * planned pathway honestly: nothing here claims progress, and no lesson links
 * exist yet, so there is no dead or fabricated navigation. The page is fully
 * static — it must render without the API, a worker, or an LLM provider.
 */

const FIRST_CURRICULUM: { title: string; summary: string }[] = [
  { title: "What language models do", summary: "Next-token prediction, capabilities and limits." },
  { title: "Tokens and tokenisation", summary: "How text becomes model input, and what that costs." },
  { title: "Embeddings and representation", summary: "Meaning as geometry — vectors, similarity, projection caveats." },
  { title: "Neural-network foundations", summary: "The minimum you need: layers, weights, training signal." },
  { title: "Transformer architecture", summary: "The block structure that everything else plugs into." },
  { title: "Attention", summary: "Content-dependent routing of information between tokens." },
  { title: "Training and next-token prediction", summary: "Loss, gradients and what pre-training optimises." },
  { title: "Inference and sampling", summary: "Temperature, top-p and where model outputs come from." },
];

const PLANNED_LATER: string[] = [
  "Context windows and KV cache",
  "Instruction tuning and PEFT",
  "Alignment, RLHF and DPO",
  "Evaluation and hallucination",
  "Embeddings, retrieval and RAG",
  "Tools, agents and memory",
  "Reasoning and test-time compute",
  "Efficiency and serving",
  "Multimodality",
  "Safety and interpretability",
];

export default function LearnPage() {
  return (
    <div
      className="fm-page"
      style={{ maxWidth: 960, margin: "0 auto", padding: "32px 40px 72px", animation: "fm-fade .3s ease" }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 7px" }}>
        Learn LLMs from first principles
      </h1>
      <p style={{ fontSize: 13, color: "var(--t3)", margin: "0 0 20px", maxWidth: 640 }}>
        A structured pathway from intuition to mechanism to the primary research — with interactive
        lessons, predictions and checkpoints.
      </p>

      <div
        role="status"
        style={{
          border: "1px solid var(--bd)",
          background: "var(--accent-bg)",
          borderRadius: 12,
          padding: "12px 16px",
          fontSize: 13,
          color: "var(--t2)",
          marginBottom: 26,
          lineHeight: 1.55,
        }}
      >
        <strong style={{ color: "var(--accent-ink)" }}>Interactive lessons are in development.</strong>{" "}
        The curriculum below is the planned pathway — no lessons are open yet and no progress is
        tracked. Meanwhile, the{" "}
        <Link href="/landscapes" style={{ color: "var(--accent-ink)", fontWeight: 600 }}>
          Research workspace
        </Link>{" "}
        maps any LLM topic into ranked papers, reading plans, quizzes and flashcards today.
      </div>

      <SectionLabel>FIRST CURRICULUM — IN BUILD</SectionLabel>
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
        {FIRST_CURRICULUM.map((t, i) => (
          <div
            key={t.title}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              padding: "13px 18px",
              borderBottom: i === FIRST_CURRICULUM.length - 1 ? "none" : "1px solid var(--bd2)",
            }}
          >
            <span
              className="font-mono"
              style={{ flex: "none", width: 22, fontSize: 11, color: "var(--t4)" }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{t.title}</div>
              <div style={{ fontSize: 12, color: "var(--t3)", marginTop: 2 }}>{t.summary}</div>
            </div>
            <span
              className="font-mono"
              style={{
                flex: "none",
                fontSize: 9.5,
                letterSpacing: "0.08em",
                color: "var(--t4)",
                border: "1px solid var(--bd)",
                borderRadius: 999,
                padding: "3px 9px",
              }}
            >
              IN BUILD
            </span>
          </div>
        ))}
      </div>

      <SectionLabel>PLANNED LATER</SectionLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {PLANNED_LATER.map((t) => (
          <span
            key={t}
            style={{
              fontSize: 12,
              color: "var(--t3)",
              border: "1px dashed var(--bd)",
              borderRadius: 999,
              padding: "6px 12px",
              background: "var(--panel)",
            }}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono"
      style={{ fontSize: 10, color: "var(--t4)", letterSpacing: "0.14em", margin: "0 0 10px" }}
    >
      {children}
    </div>
  );
}
