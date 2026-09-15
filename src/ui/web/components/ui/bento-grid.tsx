import { type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cn } from "@/lib/utils.ts";

/**
 * Magic UI's bento grid (magicui.design/docs/components/bento-grid), installed
 * through the shadcn CLI and then edited in place. A regeneration overwrites
 * this file and silently reverts the edits, so they are named here:
 *
 * - stock `BentoCard` is a marketing card — it takes `name`, `description`,
 *   `href` and `cta` and renders them itself, with a `@radix-ui/react-icons`
 *   arrow. This dashboard's tiles hold live controls, not a link, so the card
 *   takes `children` and the `background` slot, and the dependency on a second
 *   icon set is gone (the repo's icons are `lucide-react`).
 * - the grid's stock `auto-rows-[22rem]` is dropped: a settings tile is as tall
 *   as the rows inside it, and a fixed row height would either clip the engine
 *   section or leave the retention one mostly empty.
 * - colours come from the theme tokens rather than stock's `neutral-*` literals,
 *   which `test/ui/theme.test.ts` would reject anyway.
 */

const BentoGrid = ({ children, className, ...props }: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("grid w-full grid-cols-1 gap-4 lg:grid-cols-6", className)} {...props}>
    {children}
  </div>
);

const BentoCard = ({
  background,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"div"> & { background?: ReactNode }) => (
  <div
    className={cn(
      "group relative flex transform-gpu flex-col justify-between overflow-hidden rounded-xl",
      "border bg-card text-card-foreground shadow-[var(--shadow-sm)]",
      className,
    )}
    {...props}
  >
    {background !== undefined && background}
    <div className="relative z-10 flex flex-1 flex-col">{children}</div>
  </div>
);

export { BentoCard, BentoGrid };
