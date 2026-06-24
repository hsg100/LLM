// Client-side auth state. The token is a signed session token issued by the
// API (POST /api/auth/login). We keep it in localStorage and attach it as a
// Bearer header on API calls (see lib/api.ts). The whole UI is gated behind a
// login by components/auth/AuthGate.

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  is_admin: boolean;
};

const TOKEN_KEY = "fm-auth-token";
const USER_KEY = "fm-auth-user";

const isBrowser = () => typeof window !== "undefined";

export function getToken(): string | null {
  if (!isBrowser()) return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): AuthUser | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: AuthUser): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* noop */
  }
  notify();
}

export function clearSession(): void {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* noop */
  }
  notify();
}

// Lightweight pub/sub so the AuthProvider re-reads storage when the session
// changes (login, logout, or a 401-triggered clear from the api layer).
const AUTH_EVENT = "fm:auth-changed";
function notify() {
  if (isBrowser()) window.dispatchEvent(new Event(AUTH_EVENT));
}
export function onAuthChange(cb: () => void): () => void {
  if (!isBrowser()) return () => {};
  window.addEventListener(AUTH_EVENT, cb);
  return () => window.removeEventListener(AUTH_EVENT, cb);
}
export { AUTH_EVENT };
