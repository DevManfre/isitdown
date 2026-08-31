import type { ReactNode } from "react";
import { Card } from "@/components/ui/card.tsx";
import { cn } from "@/lib/utils.ts";

/**
 * One tile of a bento page: the kicker, an optional action beside it, the
 * content, and last the sentence that explains it.
 *
 * Extracted from Settings, where the four blocks each used to carry their own
 * shape — two wrapped in a `Card`, two bare, each with its own idea of where
 * the explanation and the Save button belonged — which is what made the page
 * read as a pile rather than a form. The shape is decided here once, for every
 * page laid out this way; how wide a tile is, is the grid's business at the
 * call site, not the tile's. `mt-auto` on the note is what keeps two notes in a
 * row on the same baseline when the tiles beside them stretch to equal height.
 */
export function BentoTile({
  title,
  action,
  note,
  delay,
  className,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  note?: ReactNode;
  delay: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("anim-rise gap-4 px-4", className)} style={{ animationDelay: delay }}>
      {/* `min-h-8` so a header without an action lines up with one that has a
          small Button in it, instead of sitting 8px higher. */}
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-widest text-primary">{title}</span>
        {action}
      </div>
      {children}
      {note !== undefined && <span className="mt-auto text-xs text-muted-foreground">{note}</span>}
    </Card>
  );
}
