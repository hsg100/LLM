import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = {
  width: 64,
  height: 64,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(150deg, #d4572a 0%, #b8431f 100%)",
          borderRadius: 16,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <svg
          width="64"
          height="64"
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M20 0V64M44 0V64M0 20H64M0 44H64" stroke="#f4f2ec" strokeOpacity="0.18" strokeWidth="2" />
          <path d="M19 19L46 22M19 19L31 47M46 22L31 47" stroke="white" strokeOpacity="0.62" strokeWidth="4.5" strokeLinecap="round" />
          <circle cx="19" cy="19" r="8" fill="white" />
          <circle cx="46" cy="22" r="8" fill="white" />
          <circle cx="31" cy="47" r="8" fill="white" />
        </svg>
      </div>
    ),
    size,
  );
}
