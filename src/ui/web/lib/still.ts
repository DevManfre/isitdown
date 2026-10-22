import { MotionGlobalConfig, useReducedMotion } from "motion/react";

/**
 * Whether motion should stand still: the operator asked for reduced motion, or
 * animations are switched off globally (tests, the visual harness).
 *
 * `useReducedMotion` answers `null` until motion has read the media query, so
 * on the very first render — which is when an entry decides whether to play —
 * it would say "animate" to someone who asked not to. The query is read here
 * synchronously instead, the same rule `NumberTicker` applies.
 */
export function useStill(): boolean {
  const reduced = useReducedMotion();
  if (MotionGlobalConfig.skipAnimations === true) return true;
  if (reduced !== null) return reduced;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
