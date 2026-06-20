import { ReactNode, Suspense } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { BottomTabBar } from "./BottomTabBar";

/**
 * Persistent app shell. On desktop (>=md): 256px sidebar + main column
 * with a sticky topbar. On mobile: sidebar collapses, a 5-item bottom
 * tab bar (Home / Read / Learn / Map / Search) replaces it.
 *
 * Sidebar, Topbar and BottomTabBar use `useSearchParams`, so they sit
 * inside Suspense boundaries to keep parent routes statically renderable.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="fm-app-shell"
      style={{
        display: "grid",
        height: "100vh",
        width: "100%",
        overflow: "hidden",
        background: "var(--bg)",
        color: "var(--t1)",
      }}
    >
      <Suspense
        fallback={
          <aside
            className="hidden md:block"
            style={{ background: "var(--sidebar)", borderRight: "1px solid var(--bd)" }}
          />
        }
      >
        <Sidebar />
      </Suspense>

      <main
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
          background: "var(--bg)",
        }}
      >
        <Suspense
          fallback={
            <header
              style={{
                height: 58,
                borderBottom: "1px solid var(--bd)",
                background: "var(--topbar)",
              }}
            />
          }
        >
          <Topbar />
        </Suspense>
        <div
          className="fm-scroll-area"
          style={{ flex: 1, overflowY: "auto", minHeight: 0 }}
        >
          {children}
        </div>
      </main>

      <Suspense fallback={null}>
        <BottomTabBar />
      </Suspense>
    </div>
  );
}
