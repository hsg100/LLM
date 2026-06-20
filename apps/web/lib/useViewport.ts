"use client";

import { useEffect, useState } from "react";

// Single source of truth for the mobile/desktop split. 768px matches the
// design's handoff note ("sm: breakpoints swap the grid shell for the
// tab bar") and Tailwind's md breakpoint, so any markup we use it with
// stays in sync with the `md:` classes.
const MOBILE_MAX = 767;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isMobile;
}
