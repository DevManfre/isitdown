import { useTranslation } from "react-i18next";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { UptimeStrip } from "@/components/charts/UptimeStrip.tsx";
import { useComponentHistory } from "@/hooks/queries.ts";
import { formatPercent } from "@/lib/format.ts";
import type { ComponentHistory, ComponentStatus } from "@/lib/types.ts";

const uptimeFor = (component: ComponentHistory, days: number) =>
  (days <= 7 ? component.uptime7 : days <= 30 ? component.uptime30 : component.uptime90);

/**
 * Per-component breakdown under a provider's own row. Mounted only when that
 * provider has a non-empty `componentSelection` (the parent decides), so the
 * `/history/components` request never fires for the common case of a
 * provider with nothing selected — same gating as history.js:54.
 *
 * Shared by the History view's provider blocks and the Providers table's
 * expanded rows: one provider's component breakdown reads the same in both
 * places because it is the same component, not two that drifted apart.
 *
 * `heading` is the History view's own chrome — the block sits under a
 * provider's uptime bar there with nothing else to say what it is. The
 * Providers table needs none: the row's chevron already said it, and a
 * heading inside an accordion panel is a label for a label.
 */
export function ComponentRows({
  providerId, days, current, heading,
}: {
  providerId: string;
  days: number;
  current: ComponentStatus[];
  heading?: string;
}) {
  const { t, i18n } = useTranslation();
  const { data } = useComponentHistory(providerId, days);
  if (data === undefined) return null;

  const currentById = new Map(current.map((component) => [component.id, component]));

  return (
    <div className="component-rows flex flex-col gap-2 border-t border-border pt-3">
      {heading !== undefined && (
        <span className="text-xs uppercase tracking-widest text-primary">{heading}</span>
      )}
      {data.components.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("components.unsupported")}</p>
      ) : (
        data.components.map((component) => {
          const live = currentById.get(component.componentId);
          const never = component.sampleCount === 0;
          return (
            <div key={component.componentId} className="flex items-center justify-between gap-3">
              {/* The name never shrinks: it is the row's subject, and
                  `UptimeStrip` is `w-full`, so anything that can give way
                  gets squeezed to a two-line stub (or, before, an ellipsis).
                  The strip takes what is left, down to a strip's worth. */}
              <span className="flex shrink-0 items-center gap-2 text-sm">
                <StatusDot status={live?.status ?? "unknown"} size={7} />
                <span className="break-words">{live?.name ?? component.name}</span>
              </span>
              <span className="min-w-16 flex-1">
                <UptimeStrip buckets={component.buckets} />
              </span>
              <span className={`font-mono text-xs ${never ? "text-muted-foreground" : ""}`}>
                {never ? t("components.never-measured") : formatPercent(i18n.language, uptimeFor(component, days))}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
