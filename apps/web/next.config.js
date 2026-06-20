const apiBase =
  process.env.API_URL_INTERNAL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000"] }
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiBase.replace(/\/$/, "")}/api/:path*`,
      },
      {
        source: "/ready/:path*",
        destination: `${apiBase.replace(/\/$/, "")}/ready/:path*`,
      },
      {
        source: "/health",
        destination: `${apiBase.replace(/\/$/, "")}/health`,
      },
    ];
  },
};
module.exports = nextConfig;
