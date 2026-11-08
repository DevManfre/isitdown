import { Bell, BellOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { UptimeStrip } from "@/components/charts/UptimeStrip.tsx";
import { useComponentHistory, useConfigChrome, useRoutingMutations } from "@/hooks/queries.ts";
import type { ComponentHistory, ComponentStatus } from "@/lib/types.ts";
import { statusLabelKey } from "@/lib/chartConfig.ts";
import {
  componentMuteTarget,
  isComponentSilenced,
  withComponentSilenced,
  withoutComponentSilence,
} from "@/lib/componentMute.ts";

const uptimeFor = (component: ComponentHistory, days: number) =>
  (days <= 7 ? component.uptime7 : days <= 30 ? component.uptime30 : component.uptime90);

/**
 * Roadmap 5.13. Writes the same `provider#component` rule the routing editor
 * does, so a silence made here shows up there and the other way round. Reads
 * the config through the chrome hook, which never throws: a failed config
 * request costs this row its button, not the page its render.
 *
 * Feedback is the row itself — a badge that says the word, never a colour
 * alone — and a failed save reads inline, since these toasts belong to Settings.
 */
function SilenceButton({ providerId, componentId, name }: { providerId: string; componentId: string; name: string }) {
  const { t } = useTranslation();
  const { data: config } = useConfigChrome();
  const { save } = useRoutingMutations();
  if (config === undefined) return null;

  const target = componentMuteTarget(providerId, componentId);
  const rules = config.routing.rules;
  const silenced = isComponentSilenced(rules, target);
  const label = t(silenced ? "component.silence.lift" : "component.silence.action", { name });

  return (
    <span className="flex shrink-0 items-center gap-2">
      {silenced && <Badge variant="muted">{t("component.silence.badge")}</Badge>}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        title={label}
        disabled={save.isPending}
        onClick={() => save.mutate((silenced ? withoutComponentSilence : withComponentSilenced)(rules, target))}
      >
        {silenced ? <Bell aria-hidden="true" /> : <BellOff aria-hidden="true" />}
      </Button>
      {save.isError && (
        <span role="alert" className="text-xs text-destructive">
          {t("toast.failed", { error: save.error instanceof Error ? save.error.message : String(save.error) })}
        </span>
      )}
    </span>
  );
}

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
  providerId, days, current, heading, silenceable = false,
}: {
  providerId: string;
  days: number;
  current: ComponentStatus[];
  heading?: string;
  /** A button per row that silences that component's alerts — roadmap 5.13. */
  silenceable?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data } = useComponentHistory(providerId, days);
  if (data === undefined) return null;

  const currentById = new Map(current.map((component) => [component.id, component]));

  return (
    <div className="component-rows flex flex-col gap-2 border-t border-border pt-3">
      {heading !== undefined && (
        <span className="text-base font-medium">{heading}</span>
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
                <StatusDot status={live?.status ?? "unknown"} size={7} label={t(statusLabelKey(live?.status ?? "unknown"))} />
                <span className="break-words">{live?.name ?? component.name}</span>
              </span>
              <span className="min-w-16 flex-1">
                <UptimeStrip buckets={component.buckets} />
              </span>
              <span className={`font-mono text-xs ${never ? "text-muted-foreground" : ""}`}>
                {never ? (
                  t("components.never-measured")
                ) : (
                  <NumberTicker
                    locale={i18n.language}
                    value={uptimeFor(component, days)}
                    decimalPlaces={2}
                    suffix="%"
                  />
                )}
              </span>
              {silenceable && (
                <SilenceButton
                  providerId={providerId}
                  componentId={component.componentId}
                  name={live?.name ?? component.name}
                />
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
