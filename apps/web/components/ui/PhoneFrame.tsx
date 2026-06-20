import { ReactNode } from "react";

/**
 * The mobile-first review screens (quiz / flashcards) are presented inside
 * a phone-shaped chrome on desktop so the reviewer can see exactly how
 * they render on a phone. The same components are also reused for the
 * mobile pages without this frame.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: 340,
        height: 684,
        borderRadius: 42,
        background: "#0a0a0c",
        padding: 11,
        boxShadow: "0 0 0 2px var(--bd), 0 30px 70px rgba(0,0,0,.3)",
        flex: "none",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 32,
          background: "var(--bg)",
          overflow: "hidden",
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 9,
            left: "50%",
            transform: "translateX(-50%)",
            width: 96,
            height: 24,
            background: "#0a0a0c",
            borderRadius: 999,
            zIndex: 5,
          }}
        />
        {children}
      </div>
    </div>
  );
}
