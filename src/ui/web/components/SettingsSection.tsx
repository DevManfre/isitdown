import type { ReactNode } from "react";
import { Card } from "@/components/ui/card.tsx";
import {
  SettingsSectionScope,
  useSectionCount,
  useSettingsChrome,
} from "@/components/settings/SettingsChrome.tsx";
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
 *
 * `id` is what the section rail scrolls to and what the rows inside register
 * their visibility against; a section whose rows the filter has all taken
 * leaves the page rather than sitting there as an empty card.
 */
export function SettingsSection({
  id,
  title,
  action,
  note,
  status,
  delay,
  className,
  children,
}: {
  id: string;
  title: ReactNode;
  action?: ReactNode;
  note?: ReactNode;
  status?: ReactNode;
  delay: string;
  className?: string;
  children: ReactNode;
}) {
  const footer = status ?? note;
  const count = useSectionCount(id);
  const { query } = useSettingsChrome();
  // Only the page's search field may empty a section off the page. The
  // services section has a state filter of its own (all / polling / paused /
  // muted), and picking a state nothing is in reported zero rows — which took
  // the whole card away, chips included, leaving no way back to "all". A
  // section that empties itself keeps its chrome and says so inside the card.
  const emptied = query !== "" && count === 0;

  return (
    <SettingsSectionScope value={id}>
      <section
        id={`settings-${id}`}
        data-slot="settings-section"
        // `undefined` is "no row has reported yet", which is every section on
        // the first render, and never a reason to hide.
        hidden={emptied}
        className={cn("anim-rise scroll-mt-6 flex flex-col gap-2.5", className)}
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
    </SettingsSectionScope>
  );
}
