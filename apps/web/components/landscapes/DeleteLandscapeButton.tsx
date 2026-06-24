"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteLandscape } from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";

/**
 * Admin-only delete control for a landscape row. Renders nothing for
 * non-admins. Used to clean up spam / old landscapes.
 */
export function DeleteLandscapeButton({ id, topic }: { id: string; topic: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!user?.is_admin) return null;

  async function onDelete() {
    if (busy) return;
    if (!window.confirm(`Delete landscape "${topic}"? This removes its papers, quizzes, and cards. This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await deleteLandscape(id);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || "Delete failed");
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onDelete}
      disabled={busy}
      title={err || "Delete landscape (admin)"}
      aria-label="Delete landscape"
      style={{
        all: "unset",
        cursor: busy ? "wait" : "pointer",
        padding: "5px 9px",
        borderRadius: 7,
        border: "1px solid var(--bad)",
        fontSize: 11.5,
        color: "var(--bad)",
        background: err ? "rgba(207,77,111,.10)" : "transparent",
        opacity: busy ? 0.6 : 1,
      }}
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
