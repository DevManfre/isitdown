import type { ReactNode } from "react";
import { stagger } from "@/lib/stagger.ts";
import { cn } from "@/lib/utils.ts";

export interface Stat {
  /** Stable key, and the test hook: `[data-stat="incidents"]`. */
  id: string;
  label: string;
  value: ReactNode;
  note?: ReactNode;
  /** The lit edge along the tile's top. A token var, never a literal. */
  accent?: string;
}

/**
 * A row of figures a page opens with: the four or so numbers that answer "how
 * did this window go" before any chart is read.
 *
 * Shared by History and the Delivery log because they open on the same
 * question, and a stat tile that differs between two pages reads as two
 * different kinds of figure. The line of light along the top edge is what
 * distinguishes them from the cards further down the page — these are
 * readings, not things to click.
 */
export function StatTiles({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <div
      className={cn(
        "stat-tiles grid grid-cols-2 gap-3 lg:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]",
        className,
      )}
    >
      {stats.map((stat, index) => (
        <div
          key={stat.id}
          data-stat={stat.id}
          className="anim-rise relative overflow-hidden rounded-lg border border-border bg-card/70 px-4 py-3"
          style={{ animationDelay: stagger(index, { base: 40, step: 40, cap: 240 }) }}
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage: `linear-gradient(90deg, ${stat.accent ?? "var(--color-accent)"}, transparent)`,
            }}
          />
          <span className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {stat.label}
            </span>
            <span className="font-mono text-2xl font-medium tracking-tight">{stat.value}</span>
            {stat.note !== undefined && (
              <span className="text-xs text-muted-foreground">{stat.note}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
