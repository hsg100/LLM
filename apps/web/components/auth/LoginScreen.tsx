"use client";

import { useState } from "react";
import { login } from "../../lib/api";
import { useAuth } from "./AuthProvider";
import { FieldMapLogo } from "../shell/Logo";

/**
 * Full-screen login gate. Matches the FieldMap theme (panel/border/accent
 * tokens, Geist type) used across the app.
 */
export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { token, user } = await login(email.trim(), password);
      signIn(token, user);
    } catch (err: any) {
      // Surface the API's "invalid email or password" without the verb/path noise.
      const msg = String(err?.message || "Login failed");
      setError(msg.includes("—") ? msg.split("—").slice(1).join("—").trim() : msg);
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        color: "var(--t1)",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          animation: "fm-fade .3s ease",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <div style={{ display: "inline-block", marginBottom: 18 }}>
            <FieldMapLogo size={46} />
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.025em",
              margin: "0 0 8px",
            }}
          >
            Sign in to FieldMap
          </h1>
          <p style={{ fontSize: 13.5, color: "var(--t3)", margin: 0, lineHeight: 1.6 }}>
            Access is limited to registered accounts.
          </p>
        </div>

        <form
          onSubmit={submit}
          style={{
            border: "1px solid var(--bd)",
            borderRadius: 14,
            background: "var(--panel)",
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            boxShadow: "var(--shadow)",
          }}
        >
          <Field
            label="Email"
            type="email"
            value={email}
            autoFocus
            onChange={setEmail}
            placeholder="you@example.com"
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
          />

          {error && (
            <div
              style={{
                border: "1px solid var(--bad)",
                background: "rgba(207,77,111,.10)",
                color: "var(--bad)",
                borderRadius: 9,
                padding: "9px 12px",
                fontSize: 12.5,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !email || !password}
            style={{
              all: "unset",
              textAlign: "center",
              cursor: submitting ? "wait" : "pointer",
              padding: "11px 0",
              borderRadius: 10,
              background: "var(--accent)",
              color: "#fff",
              fontSize: 13.5,
              fontWeight: 600,
              opacity: submitting || !email || !password ? 0.6 : 1,
              boxShadow: "0 2px 10px rgba(224,97,58,.28)",
            }}
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11.5, color: "var(--t3)", fontWeight: 500 }}>{label}</span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          all: "unset",
          boxSizing: "border-box",
          width: "100%",
          fontSize: 14,
          color: "var(--t1)",
          border: "1px solid var(--bd)",
          borderRadius: 9,
          padding: "10px 12px",
          background: "var(--bg)",
        }}
      />
    </label>
  );
}
