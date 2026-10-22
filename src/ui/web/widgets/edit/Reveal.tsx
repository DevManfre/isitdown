import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils.ts";
import { useStill } from "@/lib/still.ts";

/** `--ease-entry` and `--ease-out` from tokens.css, as motion wants them. */
export const EASE_ENTRY = [0.16, 1, 0.3, 1] as const;
export const EASE_EXIT = [0.22, 0.61, 0.36, 1] as const;
export const REVEAL_MS = 220;
export const CONCEAL_MS = 180;

/** The grid's row gap, which a block taking a row of its own also has to grow out of. */
const GAP_PX = 16;

/**
 * Edit mode's chrome unfolding into the page: height from nothing, so the
 * content below moves continuously instead of jumping by a toolbar's height.
 * Height is the one non-transform property here, tolerated as for any
 * accordion — there is no transform that makes room.
 *
 * `gap` is for a block that is a grid row of its own: it also grows out of the
 * row gap above it, or a zero-height row would still leave 16px behind.
 * Clipping is on only while it moves, so focus rings are never cut off at rest.
 */
export function Reveal({
  open = true,
  gap = false,
  className,
  children,
}: {
  open?: boolean;
  gap?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const reduce = useStill();
  const [moving, setMoving] = useState(!reduce);
  const shut = { height: 0, opacity: 0, marginTop: gap ? -GAP_PX : 0 };
  const shown = { height: "auto", opacity: 1, marginTop: 0 };
  return (
    <motion.div
      className={cn(className, moving && "overflow-hidden")}
      initial={reduce ? false : shut}
      animate={open ? shown : shut}
      exit={shut}
      transition={{
        duration: reduce ? 0 : (open ? REVEAL_MS : CONCEAL_MS) / 1000,
        ease: open ? EASE_ENTRY : EASE_EXIT,
      }}
      onAnimationStart={() => setMoving(true)}
      onAnimationComplete={() => setMoving(false)}
    >
      {children}
    </motion.div>
  );
}
