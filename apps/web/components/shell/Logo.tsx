export function FieldMapLogo({ size = 28 }: { size?: number }) {
  const inner = Math.round(size * 0.54);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: "linear-gradient(150deg,#e0613a,#b8431f)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 4px 14px rgba(224,97,58,.25)",
      }}
    >
      <svg width={inner} height={inner} viewBox="0 0 14 14">
        <circle cx="3" cy="3" r="1.7" fill="#fff" />
        <circle cx="11" cy="4" r="1.7" fill="#fff" />
        <circle cx="7" cy="11" r="1.7" fill="#fff" />
        <path
          d="M3 3 L11 4 M3 3 L7 11 M11 4 L7 11"
          stroke="#fff"
          strokeWidth="1"
          opacity=".6"
        />
      </svg>
    </div>
  );
}
