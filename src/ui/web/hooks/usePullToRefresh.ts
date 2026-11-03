import { useEffect, useRef, useState } from "react";

/** Distance, in px of drag, that arms the refresh. */
export const PULL_THRESHOLD = 64;
/** The most the indicator ever opens, however far the finger goes. */
export const PULL_MAX = 96;

export type PullState = "idle" | "pulling" | "ready" | "polling" | "done" | "failed";

/**
 * Pull down from the top of the page to run a poll — roadmap 4.29.
 *
 * Listens on the document rather than on a scroll container: the dashboard
 * scrolls the page itself, so "at the top" is `scrollY === 0`. A drag that
 * starts anywhere else is left to the browser, and so is a sideways one — the
 * swipe-to-mute rows own those. The pull is damped to half the finger's travel
 * so it feels like resistance rather than a slider.
 */
export function usePullToRefresh(refresh: () => Promise<unknown>): { state: PullState; distance: number } {
  const [state, setState] = useState<PullState>("idle");
  const [distance, setDistance] = useState(0);
  const start = useRef<{ y: number; x: number } | null>(null);
  const live = useRef<PullState>("idle");
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const move = (next: PullState, px: number): void => {
    live.current = next;
    setState(next);
    setDistance(px);
  };

  useEffect(() => {
    // Without this a standalone PWA runs the browser's own reload on the same drag.
    const previous = document.documentElement.style.overscrollBehaviorY;
    document.documentElement.style.overscrollBehaviorY = "contain";

    const onStart = (event: TouchEvent): void => {
      const touch = event.touches[0];
      if (touch === undefined || live.current === "polling" || window.scrollY > 0 || event.touches.length !== 1) return;
      start.current = { y: touch.clientY, x: touch.clientX };
    };
    const onMove = (event: TouchEvent): void => {
      const from = start.current;
      const touch = event.touches[0];
      if (from === null || touch === undefined) return;
      const dy = touch.clientY - from.y;
      const dx = touch.clientX - from.x;
      if (Math.abs(dx) > Math.abs(dy) || dy <= 0 || window.scrollY > 0) {
        if (live.current !== "idle") move("idle", 0);
        return;
      }
      const px = Math.min(PULL_MAX, dy * 0.5);
      move(px >= PULL_THRESHOLD ? "ready" : "pulling", px);
    };
    const onEnd = (): void => {
      if (start.current === null) return;
      start.current = null;
      if (live.current !== "ready") {
        move("idle", 0);
        return;
      }
      move("polling", PULL_THRESHOLD);
      refreshRef.current().then(
        () => move("done", PULL_THRESHOLD),
        () => move("failed", PULL_THRESHOLD),
      );
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.documentElement.style.overscrollBehaviorY = previous;
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  // The verdict ("Polled just now") stays long enough to be read, then closes.
  useEffect(() => {
    if (state !== "done" && state !== "failed") return;
    const timer = setTimeout(() => move("idle", 0), state === "done" ? 1500 : 3500);
    return () => clearTimeout(timer);
  }, [state]);

  return { state, distance };
}
