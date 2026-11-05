import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";

/**
 * A widget that can fold shut (dashboard-design-direction: hide, don't
 * delete). Its header becomes the toggle, the summary stays beside the title
 * while it is shut — so a fold never hides a problem — and the open/shut
 * choice is remembered per widget in this browser.
 */
export type WidgetDisclosure = {
  /** Where the choice is remembered; one per widget. */
  id: string;
  /** What the fold still says while it is shut: a count, a state. */
  summary?: ReactNode | undefined;
  /** The summary is about trouble: drawn in the outage colour. */
  alert?: boolean | undefined;
  /** Shut until the operator opens it, unless they have opened it before. */
  defaultOpen?: boolean | undefined;
};

const FOLD_KEY = "isitdown.widget-open.";

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(FOLD_KEY + id);
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
}

function rememberOpen(id: string, open: boolean): void {
  try {
    localStorage.setItem(FOLD_KEY + id, open ? "1" : "0");
  } catch {
    // Private window or blocked storage: the fold still works for this visit.
  }
}

/**
 * The frame every catalogue widget draws in: a title, one line of context on
 * the right, and — for anything that is a chart — the sentence that says what
 * the chart shows, so a screen reader and a glance both get the conclusion
 * without decoding the picture.
 *
 * It rises in with the view's own cascade, and a widget added later in edit
 * mode rises in the same way when it mounts. With `disclosure` it folds: the
 * body is mounted the first time it opens, so a heavy widget behind a shut
 * fold (the map) costs nothing until it is asked for.
 */
export function WidgetCard({
  title,
  meta,
  conclusion,
  tone,
  busy,
  disclosure,
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
  disclosure?: WidgetDisclosure | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  children?: ReactNode | undefined;
}) {
  const bodyId = useId();
  const [open, setOpen] = useState(() =>
    disclosure === undefined ? true : readOpen(disclosure.id, disclosure.defaultOpen ?? false),
  );
  const [mounted, setMounted] = useState(open);
  const toggle = () => {
    if (disclosure === undefined) return;
    const next = !open;
    setOpen(next);
    if (next) setMounted(true);
    rememberOpen(disclosure.id, next);
  };

  const context = (busy || meta !== undefined) && (
    <span className="shrink-0 truncate text-xs text-muted-foreground tabular-nums">{busy ? "…" : meta}</span>
  );
  const body = (
    <>
      {conclusion !== undefined && conclusion !== null && (
        <p className="text-sm leading-relaxed text-muted-foreground">{conclusion}</p>
      )}
      {children}
    </>
  );

  return (
    <Card
      data-slot="widget-card"
      data-tone={tone}
      aria-busy={busy || undefined}
      style={style}
      className={cn(
        "widget-card anim-rise min-w-0 gap-4 p-5 shadow-none",
        disclosure !== undefined && "gap-0 p-0",
        tone === "alarm" && "border-[var(--status-outage-border)]",
        tone === "warn" && "border-[var(--status-degraded-border)]",
        className,
      )}
    >
      {disclosure === undefined ? (
        <>
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <h3 className="truncate text-base font-medium">{title}</h3>
            {context}
          </div>
          {body}
        </>
      ) : (
        <>
          <h3 className="m-0">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={toggle}
              className="widget-fold-trigger flex min-h-13 w-full min-w-0 items-center gap-3 rounded-xl px-5 text-left text-base font-medium transition-colors duration-(--duration-fast) hover:bg-foreground/[0.03]"
            >
              <ChevronRight
                aria-hidden="true"
                data-open={open || undefined}
                className="widget-fold-chevron size-4 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 truncate">{title}</span>
              {disclosure.summary !== undefined && disclosure.summary !== null && (
                <span
                  className={cn(
                    "ml-auto shrink-0 truncate text-sm font-normal",
                    disclosure.alert ? "text-[var(--status-major-outage)]" : "text-muted-foreground",
                  )}
                >
                  {disclosure.summary}
                </span>
              )}
            </button>
          </h3>
          <div id={bodyId} className="widget-fold" data-open={open || undefined} inert={!open}>
            <div className="widget-fold-inner">
              <div className="flex flex-col gap-4 px-5 pt-1 pb-5">
                {meta !== undefined && <div className="flex justify-end">{context}</div>}
                {mounted && body}
              </div>
            </div>
          </div>
        </>
      )}
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
