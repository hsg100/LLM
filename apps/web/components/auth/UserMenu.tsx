"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";

/** Topbar account control: avatar button + popover with email, role, sign-out. */
export function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!user) return null;
  const initial = (user.name || user.email || "?").trim().charAt(0).toUpperCase();

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        style={{
          all: "unset",
          cursor: "pointer",
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: "1px solid var(--bd)",
          background: "var(--accent-bg)",
          color: "var(--accent-ink)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {initial}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 44,
            width: 220,
            border: "1px solid var(--bd)",
            borderRadius: 12,
            background: "var(--panel)",
            boxShadow: "var(--shadow)",
            padding: 12,
            zIndex: 50,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
            {user.name || "Account"}
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: 11,
              color: "var(--t3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {user.email}
          </div>
          <div style={{ marginTop: 8, marginBottom: 12 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                padding: "3px 8px",
                borderRadius: 6,
                color: user.is_admin ? "var(--accent-ink)" : "var(--t3)",
                background: user.is_admin ? "var(--accent-bg)" : "var(--raised)",
              }}
            >
              {user.is_admin ? "Admin" : "Member"}
            </span>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "block",
              textAlign: "center",
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 0",
              borderRadius: 8,
              border: "1px solid var(--bd)",
              background: "var(--raised)",
              color: "var(--t1)",
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
