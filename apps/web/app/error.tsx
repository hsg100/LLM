"use client";

import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "48px 40px",
        animation: "fm-fade .3s ease",
      }}
    >
      <h1
        style={{
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          margin: "0 0 8px",
        }}
      >
        Something went wrong
      </h1>
      <p style={{ fontSize: 13, color: "var(--t3)", margin: "0 0 14px" }}>
        The page hit an error while loading. This is usually a transient API
        issue — try again, or start fresh.
      </p>
      <pre
        className="font-mono"
        style={{
          fontSize: 11,
          background: "var(--raised)",
          border: "1px solid var(--bd)",
          borderRadius: 10,
          padding: "10px 12px",
          margin: "12px 0",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          color: "var(--t2)",
        }}
      >
        {error.message || String(error)}
      </pre>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={reset}
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "9px 15px",
            borderRadius: 9,
            background: "var(--accent)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Try again
        </button>
        <Link
          href="/search"
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "9px 15px",
            borderRadius: 9,
            border: "1px solid var(--bd)",
            fontSize: 13,
          }}
        >
          New landscape
        </Link>
      </div>
    </div>
  );
}
