"use client";

import { useTheme } from "../providers";

export default function DesignSystemPage() {
  const { toggle, theme } = useTheme();

  return (
    <div
      style={{
        maxWidth: 1080,
        margin: "0 auto",
        padding: "32px 40px 88px",
        animation: "fm-fade .3s ease",
      }}
    >
      <div
        className="font-mono"
        style={{
          fontSize: 11,
          color: "var(--accent-ink)",
          letterSpacing: "0.1em",
          marginBottom: 8,
        }}
      >
        DESIGN SYSTEM
      </div>
      <h1
        style={{
          fontSize: 25,
          fontWeight: 600,
          letterSpacing: "-0.025em",
          margin: "0 0 10px",
        }}
      >
        FieldMap — research OS
      </h1>
      <p
        style={{
          fontSize: 14,
          color: "var(--t3)",
          margin: "0 0 36px",
          maxWidth: 700,
          lineHeight: 1.65,
        }}
      >
        A calm, data-rich system for long research sessions. Light warm-paper
        canvas by default with a full dark mode on the header toggle, a single
        amber-red accent for action and priority, a desaturated cluster palette
        shared across both themes, and mono as a system voice for numbers, IDs,
        and labels.
      </p>

      <Section title="Surfaces & accent — current theme">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: 12,
          }}
        >
          <Swatch
            tile={{ background: "var(--bg)", border: "1px solid var(--bd)" }}
            label="canvas"
          />
          <Swatch
            tile={{ background: "var(--panel)", border: "1px solid var(--bd)" }}
            label="panel"
          />
          <Swatch
            tile={{ background: "var(--raised)", border: "1px solid var(--bd)" }}
            label="raised"
          />
          <Swatch tile={{ background: "var(--accent)" }} label="accent" />
          <Swatch
            tile={{ background: "var(--warm)", border: "1px solid var(--warm-bd)" }}
            label="warm"
          />
          <Swatch tile={{ background: "var(--t1)" }} label="ink" />
        </div>
      </Section>

      <Section title="Cluster & semantic palette">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <Chip dot="#5b8def" name="Reasoning" />
          <Chip dot="#3fb98a" name="Tool use" />
          <Chip dot="#9b7bf0" name="Multi-agent" />
          <Chip dot="#d6a23a" name="Memory" />
          <Chip dot="#e06b8a" name="Evaluation" />
        </div>
        <p
          className="font-mono"
          style={{ fontSize: 12, color: "var(--t4)", margin: 0 }}
        >
          cluster hues share ~0.13 chroma / 0.7 lightness in oklch — varied by
          hue only, readable on both themes.
        </p>
      </Section>

      <Section title="Typography — Geist + Geist Mono">
        <div
          style={{
            border: "1px solid var(--bd)",
            borderRadius: 14,
            background: "var(--panel)",
            padding: 26,
            boxShadow: "var(--shadow)",
          }}
        >
          <Row
            label="Display · 600 · -2.5%"
            content={
              <span
                style={{
                  fontSize: 30,
                  fontWeight: 600,
                  letterSpacing: "-0.025em",
                }}
              >
                The landscape of LLM agents
              </span>
            }
          />
          <Row
            label="Heading · 600 · 16px"
            content={<span style={{ fontSize: 16, fontWeight: 600 }}>Section heading</span>}
          />
          <Row
            label="Body · 14 / 1.65"
            content={
              <span style={{ fontSize: 14, color: "var(--t2)" }}>
                Body copy reads at 14px with 1.65 line-height for sustained
                reading of extractions and summaries.
              </span>
            }
          />
          <Row
            label="Mono · data, IDs, scores"
            content={
              <span
                className="font-mono"
                style={{ fontSize: 13, color: "var(--accent-ink)" }}
              >
                0.94 · arXiv:2210.03629 · CONF 92%
              </span>
            }
            last
          />
        </div>
      </Section>

      <Section title="Priority & confidence badges">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <Badge bg="var(--accent)" fg="#fff" label="Must-read" />
          <Badge bg="rgba(63,185,138,.14)" fg="#2f9d6b" label="Useful" />
          <Badge bg="rgba(106,140,192,.14)" fg="#6a8cc0" label="Optional" />
          <Badge bg="var(--raised)" fg="var(--t3)" label="Skip for now" />
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              padding: "4px 10px",
              borderRadius: 7,
              background: "var(--good-bg)",
              color: "var(--good)",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 15 15">
              <path
                d="M3 8l3 3 6-7"
                stroke="currentColor"
                strokeWidth="1.6"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Source-grounded
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
          }}
        >
          <ButtonPreview style={primaryBtn}>Primary action</ButtonPreview>
          <ButtonPreview style={secondaryBtn}>Secondary</ButtonPreview>
          <ButtonPreview style={ghostBtn}>Ghost / accent</ButtonPreview>
        </div>
      </Section>

      <Section title="Radius & theme">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
          }}
        >
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
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-end",
                marginBottom: 14,
              }}
            >
              {[7, 11, 14, 999].map((r) => (
                <div
                  key={r}
                  style={{
                    width: 40,
                    height: 40,
                    background: "var(--raised)",
                    border: "1px solid var(--bd)",
                    borderRadius: r,
                  }}
                />
              ))}
            </div>
            <div
              className="font-mono"
              style={{ fontSize: 10.5, color: "var(--t3)" }}
            >
              radii 7 · 11 · 14 · pill · base unit 4px
            </div>
          </div>

          <button
            onClick={toggle}
            style={{
              all: "unset",
              cursor: "pointer",
              border: "1px solid var(--bd)",
              borderRadius: 14,
              background: "var(--panel)",
              padding: "18px 20px",
              boxShadow: "var(--shadow)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Light + dark, one accent
            </div>
            <div
              style={{
                color: "var(--t3)",
                fontSize: 12,
                lineHeight: 1.55,
                marginBottom: 12,
              }}
            >
              Every surface is a CSS variable. Maps &amp; dashboards work in
              both. Click to flip to {theme === "dark" ? "light" : "dark"} →
            </div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontSize: 12,
                color: "var(--accent-ink)",
                fontWeight: 500,
              }}
            >
              Toggle theme
            </span>
          </button>
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 36 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>{title}</div>
      {children}
    </section>
  );
}

function Swatch({
  tile,
  label,
}: {
  tile: React.CSSProperties;
  label: string;
}) {
  return (
    <div>
      <div style={{ height: 64, borderRadius: 11, ...tile }} />
      <div
        className="font-mono"
        style={{ fontSize: 10, color: "var(--t3)", marginTop: 7 }}
      >
        {label}
      </div>
    </div>
  );
}

function Chip({ dot, name }: { dot: string; name: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "12px 14px",
        border: "1px solid var(--bd)",
        borderRadius: 11,
        background: "var(--panel)",
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: dot,
        }}
      />
      <span style={{ fontSize: 12, color: "var(--t2)" }}>{name}</span>
    </div>
  );
}

function Row({
  label,
  content,
  last,
}: {
  label: string;
  content: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 14,
        paddingBottom: last ? 0 : 14,
        borderBottom: last ? "none" : "1px solid var(--bd2)",
        marginBottom: last ? 0 : 14,
      }}
    >
      {content}
      <span
        className="font-mono"
        style={{ marginLeft: "auto", fontSize: 11, color: "var(--t4)" }}
      >
        {label}
      </span>
    </div>
  );
}

function Badge({
  bg,
  fg,
  label,
}: {
  bg: string;
  fg: string;
  label: string;
}) {
  return (
    <span
      style={{
        fontSize: 12,
        padding: "4px 11px",
        borderRadius: 7,
        color: fg,
        background: bg,
        fontWeight: 500,
      }}
    >
      {label}
    </span>
  );
}

function ButtonPreview({
  children,
  style,
}: {
  children: React.ReactNode;
  style: React.CSSProperties;
}) {
  return (
    <button style={{ all: "unset", cursor: "pointer", textAlign: "center", ...style }}>
      {children}
    </button>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: 12,
  borderRadius: 10,
  background: "var(--accent)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
};
const secondaryBtn: React.CSSProperties = {
  padding: 12,
  borderRadius: 10,
  background: "var(--raised)",
  border: "1px solid var(--bd)",
  color: "var(--t1)",
  fontSize: 13,
  fontWeight: 500,
};
const ghostBtn: React.CSSProperties = {
  padding: 12,
  borderRadius: 10,
  border: "1px solid var(--bd)",
  color: "var(--accent-ink)",
  fontSize: 13,
  fontWeight: 500,
};
