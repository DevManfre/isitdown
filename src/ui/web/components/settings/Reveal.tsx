import { useEffect, useState, type ReactNode } from "react";

/**
 * How long a closing group of rows stays mounted; in step with `.anim-fold` in
 * motion.css, which is what plays it out. Same value Providers.tsx holds its
 * expanded panel for, and for the same reason.
 */
const FOLD_MS = 220;

/**
 * The rows a switch reveals. They unfold out of the row above rather than
 * appearing at full height, and — the half that needs the state — they stay
 * mounted long enough to fold away again, because a group cut in the frame the
 * switch was clicked makes every row under it jump up its full height.
 *
 * The same `.anim-unfold` / `.anim-fold` pair the Providers table's expanded
 * panel uses, so a group opening here moves exactly like one there. The inner
 * box carries the dividers the Card would otherwise draw between these rows
 * itself: `.anim-unfold > *` is the element that clips, so it has to be a bare
 * box with no padding of its own.
 */
export function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), FOLD_MS);
    return () => clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;

  return (
    <div data-slot="setting-reveal" className={open ? "anim-unfold" : "anim-fold"}>
      <div className="flex flex-col divide-y divide-border">{children}</div>
    </div>
  );
}

