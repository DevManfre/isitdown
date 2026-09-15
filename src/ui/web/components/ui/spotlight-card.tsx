import { useRef, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The spotlight that follows the pointer across a card — Magic UI's magic-card
 * and React Bits' SpotlightCard are the same effect, and this is that effect
 * written for this dashboard rather than either package's version. The
 * departures, since neither upstream can be regenerated into this file:
 *
 * 1. No `next-themes`. Magic UI reads the theme to pick a blend mode; this
 *    repo's theme is an attribute on :root and the wash is a token that already
 *    differs per palette, so there is nothing to branch on.
 * 2. No motion values. The pointer writes two custom properties and the CSS in
 *    motion.css paints from them, which is one style write per move instead of
 *    a spring per card — a fleet view draws as many of these as there are
 *    providers.
 * 3. The wash is off until the pointer is inside the card, so a screenshot and
 *    a keyboard operator both get the unlit card, and a touch device never
 *    leaves a spotlight parked where a finger last landed.
 * 4. The hook is the primitive and the component is the convenience: tiles that
 *    already own their border and radius (the fleet's rings) light themselves
 *    rather than growing a wrapper element around every one of them.
 */
export function useSpotlight<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  const onPointerMove = (event: PointerEvent<T>) => {
    const node = ref.current;
    if (node === null) return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
    node.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
    node.style.setProperty("--spot-opacity", "1");
  };

  const onPointerLeave = () => ref.current?.style.setProperty("--spot-opacity", "0");

  return { ref, spotlightProps: { onPointerMove, onPointerLeave } };
}

export function SpotlightCard({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & Omit<React.HTMLAttributes<HTMLDivElement>, "children">) {
  const { ref, spotlightProps } = useSpotlight<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={cn("spotlight relative overflow-hidden", className)}
      {...spotlightProps}
      {...props}
    >
      {children}
    </div>
  );
}
