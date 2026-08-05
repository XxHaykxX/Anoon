"use client";

import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  mediaQuery.addEventListener("change", onChange);
  return () => mediaQuery.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** No media queries during SSR — assume motion is allowed. */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Whether the user has asked for reduced motion.
 *
 * `prefers-reduced-motion` is an external store, so it is read through
 * `useSyncExternalStore` rather than mirrored into state from an effect. That
 * distinction is the whole point of this hook: the `useState(false)` +
 * `useEffect` shape it replaces renders `false` first and only corrects itself
 * after the effect runs, so a user who asked for no motion still gets one frame
 * of the animation they opted out of — exactly the flash that triggers
 * vestibular discomfort. `useSyncExternalStore` has the real value on the first
 * client render, and its third argument keeps SSR/hydration on `false`.
 *
 * Usage: `const reduced = usePrefersReducedMotion();`
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
