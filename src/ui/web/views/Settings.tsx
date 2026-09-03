import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { BentoTile } from "@/components/BentoTile.tsx";
import { RoutingRules } from "@/components/RoutingRules.tsx";
import { ServiceDialog } from "@/components/ServiceDialog.tsx";
import { ChannelRow, ChannelSummary, channelRank } from "@/components/settings/ChannelRow.tsx";
import { RemoveServiceDialog } from "@/components/settings/RemoveServiceDialog.tsx";
import {
  useConfig,
  usePreferences,
  usePreferencesMutation,
  useRoutingMutations,
  useServiceMutations,
  useSettingsMutation,
} from "@/hooks/queries.ts";
import { useFieldProps } from "@/hooks/useBusy.tsx";
import { hostOf } from "@/lib/format.ts";
import { stagger } from "@/lib/stagger.ts";
import type { MapView } from "@/lib/types.ts";

/** The tiles enter in reading order, after the view's own frame has landed. */
const TILE_CASCADE = { base: 60, step: 60 };

/**
 * Design 3a's Settings as a bento: polling wide beside the geographic view on
 * the top row, the monitored services and the notification channels sharing the
 * one below. Port of src/ui/public/js/views/settings.js.
 *
 * A secret can be typed here but never read back: a channel field is one box
 * for the credential, and a save sends it one way — to the secrets file beside
 * the database and into the server's environment, so the channel works without
 * a restart. The value never appears again, because no route sends one. Which
 * environment variable carries it is behind the row's own toggle, along with
 * whether that variable currently resolves.
 */
export function Settings() {
  const { t } = useTranslation();
  const { data: config } = useConfig();
  const { data: preferences } = usePreferences();
  const patchPreferences = usePreferencesMutation();
  const settingsMutation = useSettingsMutation();
  const servicePatch = useServiceMutations().patch;
  const routing = useRoutingMutations();
  // Above the early return below: a hook cannot be called conditionally.
  const fieldProps = useFieldProps();

  const [interval_, setInterval_] = useState<number | undefined>(undefined);
  const [timeout_, setTimeout_] = useState<number | undefined>(undefined);
  const [retries, setRetries] = useState<number | undefined>(undefined);
  const [pollingMessage, setPollingMessage] = useState<string | undefined>(undefined);
  const [openChannel, setOpenChannel] = useState<string | undefined>(undefined);

  if (config === undefined) return null;

  const interval = interval_ ?? config.polling.intervalMinutes;
  const timeout = timeout_ ?? config.polling.requestTimeoutSeconds;
  const maxRetries = retries ?? config.polling.maxRetries;

  const savePolling = (): void => {
    setPollingMessage(undefined);
    settingsMutation.mutate(
      { intervalMinutes: interval, requestTimeoutSeconds: timeout, maxRetries },
      { onError: (error) => setPollingMessage(error instanceof Error ? error.message : String(error)) },
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
      <BentoTile
        title={t("settings.polling")}
        note={t("settings.jitter-note")}
        delay={stagger(0, TILE_CASCADE)}
        className="md:col-span-4"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="polling-interval">{t("field.interval")}</Label>
            <Input
              id="polling-interval"
              type="number"
              className="font-mono"
              value={interval}
              onChange={(event) => setInterval_(Number(event.target.value))}
              {...fieldProps}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="polling-timeout">{t("field.timeout")}</Label>
            <Input
              id="polling-timeout"
              type="number"
              className="font-mono"
              value={timeout}
              onChange={(event) => setTimeout_(Number(event.target.value))}
              {...fieldProps}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="polling-retries">{t("field.retries")}</Label>
            <Input
              id="polling-retries"
              type="number"
              className="font-mono"
              value={maxRetries}
              onChange={(event) => setRetries(Number(event.target.value))}
              {...fieldProps}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" disabled={settingsMutation.isPending} onClick={savePolling}>
            {t("action.save")}
          </Button>
          <span className="text-xs text-muted-foreground">{pollingMessage ?? t("settings.hot-note")}</span>
        </div>
      </BentoTile>

      <BentoTile
        title={t("settings.map-view")}
        note={t("settings.map-view.hint")}
        delay={stagger(1, TILE_CASCADE)}
        className="md:col-span-2"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="map-view">{t("settings.map-view.label")}</Label>
          <Select
            value={preferences?.mapView ?? "off"}
            onValueChange={(value) => patchPreferences.mutate({ mapView: value as MapView })}
          >
            <SelectTrigger id="map-view">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{t("settings.map-view.off")}</SelectItem>
              <SelectItem value="map">{t("settings.map-view.map")}</SelectItem>
              <SelectItem value="globe">{t("settings.map-view.globe")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </BentoTile>

      <BentoTile
        title={t("settings.services")}
        action={
          <ServiceDialog mode="add" trigger={<Button type="button" size="sm">{t("action.add-service")}</Button>} />
        }
        delay={stagger(2, TILE_CASCADE)}
        className="md:col-span-3"
      >
        {config.services.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("providers.empty")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {config.services.map((service) => (
              <div
                key={service.id}
                className="service-row flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{
                      background: service.enabled ? "var(--status-operational-fill)" : "var(--color-neutral-700)",
                    }}
                  />
                  {/* The name and its state hold their width and the meta
                      line gives way: with the toggle taking its place on the
                      right there is no longer room for all three, and a
                      clipped adapter reads better than a clipped provider
                      name or a row gone to two lines. */}
                  <span className="max-w-48 shrink-0 truncate text-sm">{service.name}</span>
                  {/* The state word beside the dot, as a channel row carries
                      it: colour alone does not say which of the two states a
                      muted dot means. */}
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {t(service.enabled ? "service.enabled" : "service.disabled")}
                  </span>
                  <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                    {`${service.adapter} · ${hostOf(service.baseUrl)}`}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Taking a provider out of the rotation is not deleting it:
                      the poller already skips a disabled service, and this is
                      the only place in the dashboard that can set the flag. */}
                  <Switch
                    aria-label={`${service.name} — ${t(service.enabled ? "service.enabled" : "service.disabled")}`}
                    checked={service.enabled}
                    onCheckedChange={(next) =>
                      servicePatch.mutate({ id: service.id, patch: { enabled: next } })
                    }
                  />
                  <ServiceDialog
                    mode="edit"
                    service={service}
                    trigger={
                      <Button type="button" variant="secondary" size="sm">
                        {t("action.edit")}
                      </Button>
                    }
                  />
                  <RemoveServiceDialog
                    service={service}
                    trigger={
                      <Button type="button" variant="destructive" size="sm">
                        {t("action.remove")}
                      </Button>
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </BentoTile>

      {/* The note the channel panels used to repeat one apiece is said once
          here: it is the same sentence about the same environment, and three
          channels made it three claims. */}
      <BentoTile
        title={t("settings.channels")}
        note={t("settings.secret-note")}
        delay={stagger(3, TILE_CASCADE)}
        className="md:col-span-3"
      >
        {config.channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty.no-data")}</p>
        ) : (
          <div className="flex flex-col">
            <ChannelSummary channels={config.channels} />
            {/* One row open at a time: the panel exists to be scannable, and
                every row expanded is the layout this replaced. */}
            <div className="divide-y divide-border border-t border-border">
              {[...config.channels]
                .sort((a, b) => channelRank(a) - channelRank(b))
                .map((channel) => (
                  <ChannelRow
                    key={channel.id}
                    channel={channel}
                    open={openChannel === channel.id}
                    onOpenChange={(next) => setOpenChannel(next ? channel.id : undefined)}
                  />
                ))}
            </div>
          </div>
        )}
      </BentoTile>

      {/* Immediately after the channels tile: rules are only readable with
          the channel list in view. */}
      <BentoTile
        title={t("settings.routing")}
        delay={stagger(4, TILE_CASCADE)}
        className="md:col-span-6 min-w-0"
      >
        <RoutingRules
          routing={config.routing}
          channels={config.channels}
          services={config.services}
          onSave={(rules) => routing.save.mutateAsync(rules)}
          saving={routing.save.isPending}
        />
      </BentoTile>
    </div>
  );
}
