import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";

/**
 * The frame every catalogue widget draws in: a title, one line of context in
 * mono on the right, and — for anything that is a chart — the sentence that
 * says what the chart shows, so a screen reader and a glance both get the
 * conclusion without decoding the picture.
 *
 * It rises in with the view's own cascade, and a widget added later in edit
 * mode rises in the same way when it mounts.
 */
export function WidgetCard({
  title,
  meta,
  conclusion,
  tone,
  busy,
  className,
  style,
  children,
}: {
  title: string;
  meta?: ReactNode | undefined;
  conclusion?: ReactNode | undefined;
  /** A tinted edge for a widget that is about trouble right now. */
  tone?: "alarm" | "warn" | undefined;
  /** Still loading: the card says so to assistive tech, and shows "…" where its context goes. */
  busy?: boolean | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  children?: ReactNode | undefined;
}) {
  return (
    <Card
      data-slot="widget-card"
      data-tone={tone}
      aria-busy={busy || undefined}
      style={style}
      className={cn(
        "widget-card anim-rise min-w-0 gap-3 px-5 py-4 shadow-none",
        tone === "alarm" && "border-[var(--status-outage-border)]",
        tone === "warn" && "border-[var(--status-degraded-border)]",
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <h3 className="truncate text-sm font-medium">{title}</h3>
        {(busy || meta !== undefined) && (
          <span className="shrink-0 truncate font-mono text-xs text-muted-foreground">{busy ? "…" : meta}</span>
        )}
      </div>
      {conclusion !== undefined && conclusion !== null && (
        <p className="text-sm leading-relaxed text-muted-foreground">{conclusion}</p>
      )}
      {children}
    </Card>
  );
}

/**
 * A horizontal fill, 0–1. Drawn with `scaleX` rather than a width so a new
 * value glides on the compositor instead of re-laying out the row, and so the
 * first paint grows from the left with the same transform.
 */
export function Fill({
  value,
  color,
  className,
  delay,
  label,
}: {
  value: number;
  color: string;
  className?: string | undefined;
  delay?: string | undefined;
  /** When the bar is the only place a number appears, it carries it. */
  label?: string | undefined;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div
      className={cn("relative h-2 overflow-hidden rounded-full bg-muted", className)}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    >
      <span
        className="widget-fill anim-fill absolute inset-0 origin-left rounded-full"
        style={{ transform: `scaleX(${clamped})`, background: color, animationDelay: delay }}
      />
    </div>
  );
}

/**
 * A widget whose data could not be read. Most widgets' queries throw to the
 * cell's error boundary; the ones that read through a non-throwing query
 * (shared with the shell's chrome) say it here instead of waiting on "…"
 * for ever.
 */
export function LoadFailed({ title, retry }: { title: string; retry: () => void }) {
  const { t } = useTranslation();
  return (
    <WidgetCard title={title}>
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground">{t("widget.load-failed")}</p>
        <Button type="button" variant="secondary" size="sm" onClick={retry}>
          {t("action.retry")}
        </Button>
      </div>
    </WidgetCard>
  );
}
