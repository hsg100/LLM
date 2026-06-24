"use client";

import { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { LoginScreen } from "./LoginScreen";

/**
 * Blocks all app entry until the user is logged in. While we read the stored
 * session (`ready === false`) we render nothing to avoid a login flash on
 * refresh for already-authenticated users.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();

  if (!ready) {
    return <div style={{ minHeight: "100vh", background: "var(--bg)" }} />;
  }
  if (!user) {
    return <LoginScreen />;
  }
  return <>{children}</>;
}
