import type { ReactNode } from "react";
import { useViewReady } from "@/hooks/useViewReady.ts";

/**
 * The page's one animated region, and the gate that decides when it enters.
 *
 * `data-animate` is what every entry animation in motion.css hangs off, so
 * stamping it is the single act that starts the whole cascade — hero, rings,
 * rows, charts, the geo card — from one origin. It is withheld until
 * `useViewReady` says the view's first data has landed and `hold` has cleared;
 * motion.css keeps the subtree invisible in the meantime, mounted so its
 * queries can run.
 *
 * `App` keys this component on the view, so a changed view, language or theme
 * remounts it, resets the gate and replays the cascade. A background poll
 * leaves the key untouched and plays nothing, which is the behaviour this
 * dashboard has always had.
 */
export function ViewFrame({
  view, hold = false, children,
}: {
  view: string;
  /** Something outside the view is still settling — see `usePreferenceSync`. */
  hold?: boolean;
  children: ReactNode;
}) {
  const ready = useViewReady(hold);

  return (
    <div
      id="view"
      data-animate={ready ? view : undefined}
      className="min-w-0 flex-1 px-8 py-6"
    >
      {children}
    </div>
  );
}
