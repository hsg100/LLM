"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import {
  AuthUser,
  clearSession,
  getStoredUser,
  getToken,
  onAuthChange,
  setSession as persistSession,
} from "../../lib/auth";

type AuthState = {
  user: AuthUser | null;
  ready: boolean; // false until we've read localStorage (avoids login flash on refresh)
  signIn: (token: string, user: AuthUser) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthState>({
  user: null,
  ready: false,
  signIn: () => {},
  signOut: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(() => {
    const token = getToken();
    setUser(token ? getStoredUser() : null);
  }, []);

  useEffect(() => {
    refresh();
    setReady(true);
    return onAuthChange(refresh);
  }, [refresh]);

  const signIn = useCallback((token: string, u: AuthUser) => {
    persistSession(token, u);
    setUser(u);
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
