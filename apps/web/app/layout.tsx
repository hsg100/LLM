import "./globals.css";
import type { Metadata } from "next";
import { ReactNode } from "react";
import { Nav } from "../components/Nav";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "FieldMap",
  description: "Personal AI research and learning engine for ML/AI papers",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-paper text-ink">
        <Providers>
          <Nav />
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
