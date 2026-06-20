"use client";

import { Flashcard } from "../../lib/api";
import { clusterColor } from "../../lib/clusters";

export type FlashcardInteriorProps = {
  topic: string;
  total: number;
  idx: number;
  flipped: boolean;
  current: Flashcard | null;
  loading: boolean;
  onFlip: () => void;
  onAdvance: (asKnown: boolean) => void;
};

export function FlashcardInterior(props: FlashcardInteriorProps) {
  const { topic, total, idx, flipped, current, loading, onFlip, onAdvance } = props;

  return (
    <>
      <div style={{ padding: "14px 20px 16px", borderBottom: "1px solid var(--bd)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {topic || "Landscape"} · Cards
          </span>
          {total > 0 && (
            <span
              className="font-mono"
              style={{ fontSize: 11, color: "var(--t3)" }}
            >
              {idx + 1}/{total}
            </span>
          )}
        </div>
        <div
          style={{
            height: 4,
            borderRadius: 2,
            background: "var(--raised)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: total ? `${((idx + 1) / total) * 100}%` : "0%",
              background: "var(--accent)",
              transition: "width .3s",
            }}
          />
        </div>
      </div>

      {loading && (
        <div style={{ padding: 24, color: "var(--t3)", fontSize: 13 }}>
          Loading…
        </div>
      )}

      {!loading && total === 0 && (
        <div style={{ padding: 24, color: "var(--t3)", fontSize: 13 }}>
          No flashcards yet for this landscape.
        </div>
      )}

      {current && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "24px 20px",
            minHeight: 0,
          }}
        >
          <button
            onClick={onFlip}
            style={{
              all: "unset",
              cursor: "pointer",
              flex: 1,
              perspective: 1200,
              marginBottom: 18,
            }}
          >
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "100%",
                transition: "transform .5s",
                transformStyle: "preserve-3d",
                transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                  borderRadius: 20,
                  border: "1px solid var(--bd)",
                  background: "var(--panel)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 28,
                  textAlign: "center",
                  boxShadow: "var(--shadow)",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 18,
                    left: 18,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 10.5,
                    color: "var(--t3)",
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: clusterColor(current.concept),
                    }}
                  />
                  {current.concept || current.kind}
                </span>
                <span
                  className="font-mono"
                  style={{
                    fontSize: 9.5,
                    color: "var(--t4)",
                    position: "absolute",
                    top: 18,
                    right: 18,
                  }}
                >
                  TERM
                </span>
                <div
                  style={{
                    fontSize: 25,
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    lineHeight: 1.25,
                  }}
                >
                  {current.front}
                </div>
                <div
                  style={{
                    position: "absolute",
                    bottom: 20,
                    fontSize: 11,
                    color: "var(--t4)",
                  }}
                >
                  tap to reveal
                </div>
              </div>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                  transform: "rotateY(180deg)",
                  borderRadius: 20,
                  border: "1px solid var(--warm-bd)",
                  background: "var(--warm)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 28,
                  textAlign: "center",
                  boxShadow: "var(--shadow)",
                }}
              >
                <span
                  className="font-mono"
                  style={{
                    fontSize: 9.5,
                    color: "var(--accent-ink)",
                    position: "absolute",
                    top: 18,
                    right: 18,
                  }}
                >
                  DEFINITION
                </span>
                <div
                  style={{ fontSize: 15, lineHeight: 1.55, color: "var(--t1)" }}
                >
                  {current.back}
                </div>
              </div>
            </div>
          </button>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => onAdvance(false)}
              style={actionBtn("var(--warn)")}
            >
              Review again
            </button>
            <button onClick={() => onAdvance(true)} style={actionBtn("var(--good)")}>
              I knew it
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function actionBtn(color: string): React.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    flex: 1,
    textAlign: "center",
    padding: 15,
    borderRadius: 13,
    border: `1.5px solid ${color}`,
    color,
    fontSize: 13.5,
    fontWeight: 600,
  };
}
