"use client";

// Persists the most-recently-visited landscape id so the mobile bottom tab
// bar can route Home / Read / Learn / Map to it when the current URL
// doesn't carry an id.

const KEY = "fm-last-landscape";

export function rememberLandscape(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

export function readLastLandscape(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
