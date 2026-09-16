import { Children, isValidElement, memo, useMemo, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion, type MotionProps } from "motion/react";

import { cn } from "@/lib/utils";

/**
 * Magic UI's animated list (magicui.design/docs/components/animated-list),
 * ported by hand rather than through the shadcn CLI — the CLI cannot resolve
 * this repo's `@/` alias and rewrites theme files on the way past (see the
 * `shadcn-components` skill). Three deliberate departures from upstream, named
 * here because a regeneration would silently revert them:
 *
 * 1. **Live, not a reveal.** Upstream is a landing-page showcase: it holds a
 *    fixed array of children and walks an index forward on a timer, so the
 *    list fills itself up once and then loops. The dashboard needs the other
 *    half of that component — the spring that carries a real item in and out
 *    as it actually happens. So there is no timer and no `delay` prop: every
 *    child passed in is on screen, and the caller owns what the list holds.
 * 2. **Newest first is the caller's job.** Upstream reverses its slice
 *    internally. Here the array arrives in the order it should be painted,
 *    which is the only way a caller can choose to grow the stack upwards
 *    (bottom-anchored toasts) rather than downwards.
 * 3. **Reduced motion drops the spring**, as everywhere else in the dashboard:
 *    the item still appears and disappears, it just does not travel. That also
 *    keeps the visual harness still, since it renders with
 *    --force-prefers-reduced-motion.
 *
 * Items are keyed by the child's own `key`, so React and `AnimatePresence`
 * agree on which item left — a list keyed by index animates the wrong row out.
 */
export function AnimatedListItem({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();

  const animations: MotionProps = reduced
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0 },
      }
    : {
        initial: { scale: 0.9, opacity: 0, y: 12 },
        animate: { scale: 1, opacity: 1, y: 0, originY: 1 },
        exit: { scale: 0.9, opacity: 0, y: 12 },
        transition: { type: "spring", stiffness: 350, damping: 40 },
      };

  return (
    <motion.div {...animations} layout className="w-full">
      {children}
    </motion.div>
  );
}

export interface AnimatedListProps extends ComponentPropsWithoutRef<"div"> {
  children: ReactNode;
}

export const AnimatedList = memo(({ children, className, ...props }: AnimatedListProps) => {
  const items = useMemo(() => Children.toArray(children).filter(isValidElement), [children]);

  return (
    <div className={cn("flex flex-col items-center gap-2", className)} {...props}>
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <AnimatedListItem key={item.key}>{item}</AnimatedListItem>
        ))}
      </AnimatePresence>
    </div>
  );
});

AnimatedList.displayName = "AnimatedList";
