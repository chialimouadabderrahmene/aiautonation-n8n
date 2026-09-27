"use client";

import { useEffect, useRef } from "react";

/** Calls `fn` every `ms` while `active` and the tab is visible. */
export function usePolling(fn: () => void | Promise<void>, ms: number, active = true) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void saved.current();
    }, ms);
    return () => clearInterval(id);
  }, [ms, active]);
}
