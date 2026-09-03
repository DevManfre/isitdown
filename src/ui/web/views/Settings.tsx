import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { ServiceDialog } from "@/components/ServiceDialog.tsx";
import { SettingRow } from "@/components/SettingRow.tsx";
import { SettingsSection } from "@/components/SettingsSection.tsx";
import { ChannelRow, ChannelSummary, channelRank } from "@/components/settings/ChannelRow.tsx";
import { RemoveServiceDialog } from "@/components/settings/RemoveServiceDialog.tsx";
import { RoutingRulesDialog } from "@/components/settings/RoutingRulesDialog.tsx";
import {
  useConfig,
  usePreferences,
  usePreferencesMutation,
  useServiceMutations,
  useSettingsMutation,
} from "@/hooks/queries.ts";
import { useFieldProps } from "@/hooks/useBusy.tsx";
import { hostOf } from "@/lib/format.ts";
import { stagger } from "@/lib/stagger.ts";
import type { MapView } from "@/lib/types.ts";

/** Sections enter in reading order, after the view's own frame has landed. */
const SECTION_CASCADE = { base: 60, step: 60 };

/**
 * Settings as one column of named sections — engine, monitored services,
 * notification channels, appearance — each its own card of divided rows.
 * Port of src/ui/public/js/views/settings.js.
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs leading-relaxed text-muted-foreground">{t("settings.subtitle")}</span>
      </div>

      <SettingsSection
        title={t("settings.section.engine")}
        note={t("settings.jitter-note")}
        status={pollingMessage}
        delay={stagger(0, SECTION_CASCADE)}
      >
        <SettingRow label={t("field.interval")} description={t("field.interval.hint")} align="top">
          <Input
            id="polling-interval"
            aria-label={t("field.interval")}
            type="number"
            className="w-20 text-right font-mono"
            value={interval}
            onChange={(event) => setInterval_(Number(event.target.value))}
            {...fieldProps}
          />
          <span className="font-mono text-xs text-muted-foreground">{t("unit.minutes")}</span>
        </SettingRow>
        <SettingRow label={t("field.timeout")} description={t("field.timeout.hint")} align="top">
          <Input
            id="polling-timeout"
            aria-label={t("field.timeout")}
            type="number"
            className="w-20 text-right font-mono"
            value={timeout}
            onChange={(event) => setTimeout_(Number(event.target.value))}
            {...fieldProps}
          />
          <span className="font-mono text-xs text-muted-foreground">{t("unit.seconds")}</span>
        </SettingRow>
        <SettingRow label={t("field.retries")} description={t("field.retries.hint")} align="top">
          <Input
            id="polling-retries"
            aria-label={t("field.retries")}
            type="number"
            className="w-20 text-right font-mono"
            value={maxRetries}
            onChange={(event) => setRetries(Number(event.target.value))}
            {...fieldProps}
          />
        </SettingRow>
        <SettingRow label={t("settings.hot-note")}>
          <Button type="button" size="sm" disabled={settingsMutation.isPending} onClick={savePolling}>
            {t("action.save")}
          </Button>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title={t("settings.section.services")}
        action={<ServiceDialog mode="add" trigger={<Button type="button" size="sm">{t("action.add-service")}</Button>} />}
        delay={stagger(1, SECTION_CASCADE)}
      >
        {config.services.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{t("providers.empty")}</p>
        ) : (
          config.services.map((service) => (
            <SettingRow
              key={service.id}
              className="service-row"
              label={service.name}
              description={`${service.adapter} · ${hostOf(service.baseUrl)}`}
              leading={
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{
                    background: service.enabled ? "var(--status-operational-fill)" : "var(--color-neutral-700)",
                  }}
                />
              }
              meta={t(service.enabled ? "service.enabled" : "service.disabled")}
            >
              <Switch
                aria-label={`${service.name} — ${t(service.enabled ? "service.enabled" : "service.disabled")}`}
                checked={service.enabled}
                onCheckedChange={(next) => servicePatch.mutate({ id: service.id, patch: { enabled: next } })}
              />
              {/* The variants are the ones these two buttons already carry — the
                  row shape changes, the actions do not. */}
              <ServiceDialog
                mode="edit"
                service={service}
                trigger={<Button type="button" variant="secondary" size="sm">{t("action.edit")}</Button>}
              />
              <RemoveServiceDialog
                service={service}
                trigger={<Button type="button" variant="destructive" size="sm">{t("action.remove")}</Button>}
              />
            </SettingRow>
          ))
        )}
      </SettingsSection>

      <SettingsSection
        title={t("settings.section.notifications")}
        note={t("settings.secret-note")}
        delay={stagger(2, SECTION_CASCADE)}
      >
        {config.channels.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{t("empty.no-data")}</p>
        ) : (
          <div className="flex flex-col px-4 pt-3">
            <ChannelSummary channels={config.channels} />
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
        <SettingRow
          label={t("settings.routing")}
          description={t("settings.routing.hint")}
          meta={t("settings.routing.count", { count: config.routing.rules.length })}
          align="top"
        >
          <RoutingRulesDialog routing={config.routing} channels={config.channels} services={config.services} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t("settings.section.appearance")} delay={stagger(3, SECTION_CASCADE)}>
        <SettingRow
          label={t("settings.map-view.label")}
          description={t("settings.map-view.hint")}
          align="top"
        >
          <Select
            value={preferences?.mapView ?? "off"}
            onValueChange={(value) => patchPreferences.mutate({ mapView: value as MapView })}
          >
            <SelectTrigger id="map-view" className="w-42" aria-label={t("settings.map-view.label")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{t("settings.map-view.off")}</SelectItem>
              <SelectItem value="map">{t("settings.map-view.map")}</SelectItem>
              <SelectItem value="globe">{t("settings.map-view.globe")}</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
