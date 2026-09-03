import type { ReactNode } from "react";
import { Card } from "@/components/ui/card.tsx";
import { cn } from "@/lib/utils.ts";

/**
 * One named group of the Settings page: a kicker (with an optional action,
 * beside it) above a single card of divided rows, and last a footer that
 * carries either the sentence explaining the group or what just happened to
 * it.
 *
 * Confirmation lives in this footer rather than on each row on purpose: with
 * instant-apply, three rows saved one after another would otherwise stack
 * three lines of chrome inside the card and move every row below them.
 */
export function SettingsSection({
  title,
  action,
  note,
  status,
  delay,
  className,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  note?: ReactNode;
  status?: ReactNode;
  delay: string;
  className?: string;
  children: ReactNode;
}) {
  const footer = status ?? note;

  return (
    <section
      data-slot="settings-section"
      className={cn("anim-rise flex flex-col gap-2.5", className)}
      style={{ animationDelay: delay }}
    >
      {/* `min-h-8` so a kicker without an action lines up with one that has a
          small Button in it, instead of sitting 8px higher. */}
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-widest text-primary">{title}</span>
        {action}
      </div>
      <Card className="gap-0 divide-y divide-border py-0">
        {children}
        {footer !== undefined && footer !== null && (
          <div data-slot="settings-section-footer" className="px-4 py-2.5 text-xs text-muted-foreground">
            {footer}
          </div>
        )}
      </Card>
    </section>
  );
}
