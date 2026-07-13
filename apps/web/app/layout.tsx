import "./globals.css";
import type { Metadata } from "next";
import { ReactNode } from "react";
import { Providers } from "./providers";
import { AppShell } from "../components/shell/AppShell";
import { AuthGate } from "../components/auth/AuthGate";

export const metadata: Metadata = {
  title: "FieldMap — learn and research LLMs",
  description:
    "An interactive learning and research environment for understanding LLMs from first principles to current research",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-fm="light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          <AuthGate>
            <AppShell>{children}</AppShell>
          </AuthGate>
        </Providers>
      </body>
    </html>
  );
}
