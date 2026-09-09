import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { ServiceDialog } from "@/components/ServiceDialog.tsx";
import { SettingRow } from "@/components/SettingRow.tsx";
import { SettingsSection } from "@/components/SettingsSection.tsx";
import { AdapterDebugDialog } from "@/components/settings/AdapterDebugDialog.tsx";
import { Reveal } from "@/components/settings/Reveal.tsx";
import { ChannelRow, ChannelSummary, channelRank } from "@/components/settings/ChannelRow.tsx";
import { MuteMenu } from "@/components/settings/MuteMenu.tsx";
import { RemoveServiceDialog } from "@/components/settings/RemoveServiceDialog.tsx";
import { RoutingRulesDialog } from "@/components/settings/RoutingRulesDialog.tsx";
import {
  useConfig,
  useConfigImport,
  usePreferences,
  usePreferencesMutation,
  useServiceMutations,
  useSettingsMutation,
  useStorage,
} from "@/hooks/queries.ts";
import { useFieldProps } from "@/hooks/useBusy.tsx";
import { formatBytes, formatRelative, hostOf } from "@/lib/format.ts";
import { isMuted } from "@/lib/mute.ts";
import { effectiveTimeZone, setTimeZone, TIME_ZONES } from "@/lib/timeZone.ts";
import { stagger } from "@/lib/stagger.ts";
import type { DeliveryPolicy, MapView, SeverityFloorName } from "@/lib/types.ts";
// The floors come from core's own list rather than a copy: a floor added there
// has to appear here, and a literal array would silently not.
import { SEVERITY_FLOORS } from "../../../core/routing.ts";

/** Sections enter in reading order, after the view's own frame has landed. */
const SECTION_CASCADE = { base: 60, step: 60 };

/**
 * The bounds `pollingSchema` already enforces server-side. Checked here too,
 * because instant-apply means a half-typed "99" retries would otherwise fire a
 * request the server can only answer with a 400 — an error about a value the
 * operator was still in the middle of typing.
 */
const POLLING_BOUNDS = {
  intervalMinutes: { min: 1, max: 1440, labelKey: "field.interval" },
  requestTimeoutSeconds: { min: 1, max: 120, labelKey: "field.timeout" },
  maxRetries: { min: 1, max: 10, labelKey: "field.retries" },
} as const;

/** Same bounds `pollingSchema` enforces for the adaptive cadence, same reason. */
const ADAPTIVE_BOUNDS = { min: 1, max: 1440 } as const;

/**
 * Flap damping. One is off, and the ceiling is deliberately low: a transition
 * held for more than a handful of polls is a mute with extra steps, and the
 * mute is a control of its own.
 */
const CONFIRM_BOUNDS = { min: 1, max: 10 } as const;

/** Long enough that a two-keystroke number is one save, short enough to feel immediate. */
const POLLING_DEBOUNCE_MS = 600;

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
/** Same reason as `POLLING_BOUNDS`: instant-apply must not fire a half-typed number at the server. */
const RETENTION_BOUNDS = { min: 7, max: 3650 };

/**
 * What a server from before the delivery policy existed answers with, and what
 * every field means when nothing has been configured: all of it off.
 */
const DELIVERY_OFF: DeliveryPolicy = {
  quietHours: { enabled: false, start: "23:00", end: "07:00", timeZone: "auto", minSeverity: "major_outage" },
  digest: { enabled: false, windowMinutes: 15, immediateFloor: "major_outage" },
  cap: { enabled: false, maxPerHour: 10 },
  updateInPlace: false,
};

/** The two typed numbers in the delivery section, bounded like the engine's. */
const DELIVERY_BOUNDS = {
  windowMinutes: { min: 1, max: 1440, labelKey: "field.digest.window" },
  maxPerHour: { min: 1, max: 1000, labelKey: "field.cap.max" },
};

/**
 * A severity floor, in the same words in all three places one is chosen. Its
 * own component because "any" and "major outage only" are the ends of one
 * scale, and three hand-written option lists is three chances to word one
 * end differently from the others.
 */
function FloorSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: SeverityFloorName;
  onChange: (value: SeverityFloorName) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select value={value} onValueChange={(next) => onChange(next as SeverityFloorName)}>
      <SelectTrigger id={id} className="w-56" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SEVERITY_FLOORS.map((floor) => (
          <SelectItem key={floor} value={floor}>
            {t(`severity.floor.${floor}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Settings() {
  const { t, i18n } = useTranslation();
  const { data: config } = useConfig();
  const { data: preferences } = usePreferences();
  const patchPreferences = usePreferencesMutation();
  const settingsMutation = useSettingsMutation();
  const { data: storage } = useStorage();
  const { patch: servicePatch, restore: serviceRestore, purge: servicePurge } = useServiceMutations();
  const configImport = useConfigImport();
  const [importStatus, setImportStatus] = useState<{ text: string; tone: "ok" | "error" } | undefined>(undefined);
  // Above the early return below: a hook cannot be called conditionally.
  const fieldProps = useFieldProps();

  const [interval_, setInterval_] = useState<number | undefined>(undefined);
  const [timeout_, setTimeout_] = useState<number | undefined>(undefined);
  const [retries, setRetries] = useState<number | undefined>(undefined);
  const [pollingStatus, setPollingStatus] = useState<{ text: string; tone: "ok" | "error" } | undefined>(undefined);
  const [adaptiveInterval_, setAdaptiveInterval] = useState<number | undefined>(undefined);
  const [confirmSamples_, setConfirmSamples] = useState<number | undefined>(undefined);
  const [retentionDays_, setRetentionDays] = useState<number | undefined>(undefined);
  const [retentionStatus, setRetentionStatus] = useState<{ text: string; tone: "ok" | "error" } | undefined>(
    undefined,
  );
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [openChannel, setOpenChannel] = useState<string | undefined>(undefined);
  const [digestWindow_, setDigestWindow] = useState<number | undefined>(undefined);
  const [capPerHour_, setCapPerHour] = useState<number | undefined>(undefined);
  const [deliveryStatus, setDeliveryStatus] = useState<{ text: string; tone: "ok" | "error" } | undefined>(
    undefined,
  );

  useEffect(() => {
    return () => {
      if (debounce.current !== undefined) clearTimeout(debounce.current);
    };
  }, []);

  if (config === undefined) return null;

  const interval = interval_ ?? config.polling.intervalMinutes;
  const timeout = timeout_ ?? config.polling.requestTimeoutSeconds;
  const maxRetries = retries ?? config.polling.maxRetries;
  // Defaulted rather than assumed present: a server from before adaptive
  // polling (roadmap 2.3) answers without these two, and the section still has
  // to render.
  const adaptivePolling = config.polling.adaptivePolling ?? true;
  const adaptiveInterval = adaptiveInterval_ ?? config.polling.adaptiveIntervalMinutes ?? 1;
  // Defaulted for the same reason as the two above: a server from before flap
  // damping answers without the field, and one sample is what it was doing.
  const confirmSamples = confirmSamples_ ?? config.polling.confirmSamples ?? 1;
  const retentionDays = retentionDays_ ?? config.retention.days;
  // Defaulted rather than assumed: the section only exists when a removal is
  // waiting, and an older payload carries no list at all.
  const removed = config.removed ?? [];
  const delivery = config.delivery ?? DELIVERY_OFF;
  const digestWindow = digestWindow_ ?? delivery.digest.windowMinutes;
  const capPerHour = capPerHour_ ?? delivery.cap.maxPerHour;

  /**
   * One field of the delivery policy at a time. The patch is partial at every
   * level, so a floor changed here cannot write back a window the operator is
   * still typing into.
   */
  const commitDelivery = (patch: {
    quietHours?: Partial<DeliveryPolicy["quietHours"]>;
    digest?: Partial<DeliveryPolicy["digest"]>;
    cap?: Partial<DeliveryPolicy["cap"]>;
    updateInPlace?: boolean;
  }): void => {
    setDeliveryStatus(undefined);
    settingsMutation.mutate(
      { delivery: patch },
      {
        onSuccess: () => setDeliveryStatus({ text: t("settings.saved"), tone: "ok" }),
        onError: (error) =>
          setDeliveryStatus({ text: error instanceof Error ? error.message : String(error), tone: "error" }),
      },
    );
  };

  /** Bounds-checked before it is sent, for the same reason the engine's numbers are. */
  const commitDeliveryNumber = (field: keyof typeof DELIVERY_BOUNDS, value: number): void => {
    const bound = DELIVERY_BOUNDS[field];
    if (!Number.isInteger(value) || value < bound.min || value > bound.max) {
      setDeliveryStatus({
        text: t("settings.out-of-range", { field: t(bound.labelKey), min: bound.min, max: bound.max }),
        tone: "error",
      });
      return;
    }
    commitDelivery(
      field === "windowMinutes" ? { digest: { windowMinutes: value } } : { cap: { maxPerHour: value } },
    );
  };

  const commitPolling = (next: {
    intervalMinutes: number;
    requestTimeoutSeconds: number;
    maxRetries: number;
  }): void => {
    if (debounce.current !== undefined) clearTimeout(debounce.current);

    for (const [key, bound] of Object.entries(POLLING_BOUNDS)) {
      const value = next[key as keyof typeof next];
      if (!Number.isInteger(value) || value < bound.min || value > bound.max) {
        setPollingStatus({
          text: t("settings.out-of-range", { field: t(bound.labelKey), min: bound.min, max: bound.max }),
          tone: "error",
        });
        return;
      }
    }

    setPollingStatus(undefined);
    settingsMutation.mutate(next, {
      onSuccess: () => setPollingStatus({ text: t("settings.saved"), tone: "ok" }),
      onError: (error) =>
        setPollingStatus({ text: error instanceof Error ? error.message : String(error), tone: "error" }),
    });
  };

  const schedulePolling = (next: Parameters<typeof commitPolling>[0]): void => {
    if (debounce.current !== undefined) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => commitPolling(next), POLLING_DEBOUNCE_MS);
  };

  /**
   * The adaptive pair saves on its own rather than through `commitPolling`: the
   * switch is an instant apply with nothing to debounce, and sending the three
   * engine numbers along with it would write fields the operator did not touch.
   */
  const commitAdaptive = (patch: { adaptivePolling?: boolean; adaptiveIntervalMinutes?: number }): void => {
    const minutes = patch.adaptiveIntervalMinutes;
    if (
      minutes !== undefined &&
      (!Number.isInteger(minutes) || minutes < ADAPTIVE_BOUNDS.min || minutes > ADAPTIVE_BOUNDS.max)
    ) {
      setPollingStatus({
        text: t("settings.out-of-range", {
          field: t("field.adaptive-interval"),
          min: ADAPTIVE_BOUNDS.min,
          max: ADAPTIVE_BOUNDS.max,
        }),
        tone: "error",
      });
      return;
    }
    setPollingStatus(undefined);
    settingsMutation.mutate(patch, {
      onSuccess: () => setPollingStatus({ text: t("settings.saved"), tone: "ok" }),
      onError: (error) =>
        setPollingStatus({ text: error instanceof Error ? error.message : String(error), tone: "error" }),
    });
  };

  const commitConfirm = (samples: number): void => {
    if (!Number.isInteger(samples) || samples < CONFIRM_BOUNDS.min || samples > CONFIRM_BOUNDS.max) {
      setPollingStatus({
        text: t("settings.out-of-range", {
          field: t("field.confirm-samples"),
          min: CONFIRM_BOUNDS.min,
          max: CONFIRM_BOUNDS.max,
        }),
        tone: "error",
      });
      return;
    }
    setPollingStatus(undefined);
    settingsMutation.mutate({ confirmSamples: samples }, {
      onSuccess: () => setPollingStatus({ text: t("settings.saved"), tone: "ok" }),
      onError: (error) =>
        setPollingStatus({ text: error instanceof Error ? error.message : String(error), tone: "error" }),
    });
  };

  const commitRetention = (days: number): void => {
  /**
   * Reads the picked file and hands it to the server as it stands (roadmap
   * 4.3): the validation that matters is the file schema's, and it lives on the
   * server where the Light edition's loader already is.
   */
  const runImport = async (file: File): Promise<void> => {
    setImportStatus(undefined);
    try {
      const report = await configImport.mutateAsync(await file.text());
      setImportStatus({
        text: t("settings.backup.imported", {
          added: report.added.length,
          updated: report.updated.length,
          removed: report.removed.length,
        }),
        tone: "ok",
      });
    } catch (error) {
      setImportStatus({ text: error instanceof Error ? error.message : String(error), tone: "error" });
    }
  };

    if (!Number.isInteger(days) || days < RETENTION_BOUNDS.min || days > RETENTION_BOUNDS.max) {
      setRetentionStatus({
        text: t("settings.out-of-range", {
          field: t("field.retention"),
          min: RETENTION_BOUNDS.min,
          max: RETENTION_BOUNDS.max,
        }),
        tone: "error",
      });
      return;
    }
    setRetentionStatus(undefined);
    settingsMutation.mutate(
      { retentionDays: days },
      {
        onSuccess: () => setRetentionStatus({ text: t("settings.saved"), tone: "ok" }),
        onError: (error) =>
          setRetentionStatus({ text: error instanceof Error ? error.message : String(error), tone: "error" }),
      },
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs leading-relaxed text-muted-foreground">{t("settings.subtitle")}</span>
      </div>

      <SettingsSection
        title={t("settings.section.engine")}
        status={
          pollingStatus === undefined ? undefined : (
            <span className={pollingStatus.tone === "error" ? "text-destructive" : "text-[var(--status-operational)]"}>
              {pollingStatus.text}
            </span>
          )
        }
        delay={stagger(0, SECTION_CASCADE)}
      >
        <SettingRow label={t("field.interval")} description={t("field.interval.hint")} align="top">
          <Input
            id="polling-interval"
            aria-label={t("field.interval")}
            type="number"
            className="w-20 text-right font-mono"
            value={interval}
            onChange={(event) => {
              const value = Number(event.target.value);
              setInterval_(value);
              schedulePolling({ intervalMinutes: value, requestTimeoutSeconds: timeout, maxRetries });
            }}
            onFocus={fieldProps.onFocus}
            onBlur={() => {
              fieldProps.onBlur();
              commitPolling({ intervalMinutes: interval, requestTimeoutSeconds: timeout, maxRetries });
            }}
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
            onChange={(event) => {
              const value = Number(event.target.value);
              setTimeout_(value);
              schedulePolling({ intervalMinutes: interval, requestTimeoutSeconds: value, maxRetries });
            }}
            onFocus={fieldProps.onFocus}
            onBlur={() => {
              fieldProps.onBlur();
              commitPolling({ intervalMinutes: interval, requestTimeoutSeconds: timeout, maxRetries });
            }}
          />
          <span className="font-mono text-xs text-muted-foreground">{t("unit.seconds")}</span>
        </SettingRow>
        <SettingRow label={t("field.adaptive")} description={t("field.adaptive.hint")} align="top">
          <Switch
            id="adaptive-polling"
            aria-label={t("field.adaptive")}
            checked={adaptivePolling}
            onCheckedChange={(next) => commitAdaptive({ adaptivePolling: next })}
          />
        </SettingRow>
        {/* Only while it is on: a cadence for a behaviour that is switched off
            is a field that changes nothing. Unfolded rather than appeared, for
            the same reason the delivery groups below are — this row had the
            same jump before `Reveal` existed. */}
        <Reveal open={adaptivePolling}>
          <SettingRow
            label={t("field.adaptive-interval")}
            description={t("field.adaptive-interval.hint")}
            align="top"
          >
            <Input
              id="adaptive-interval"
              aria-label={t("field.adaptive-interval")}
              type="number"
              className="w-20 text-right font-mono"
              value={adaptiveInterval}
              onChange={(event) => setAdaptiveInterval(Number(event.target.value))}
              onFocus={fieldProps.onFocus}
              onBlur={() => {
                fieldProps.onBlur();
                commitAdaptive({ adaptiveIntervalMinutes: adaptiveInterval });
              }}
            />
            <span className="font-mono text-xs text-muted-foreground">{t("unit.minutes")}</span>
          </SettingRow>
        </Reveal>
        <SettingRow
          label={t("field.confirm-samples")}
          description={t("field.confirm-samples.hint")}
          align="top"
        >
          <Input
            id="confirm-samples"
            aria-label={t("field.confirm-samples")}
            type="number"
            className="w-20 text-right font-mono"
            value={confirmSamples}
            onChange={(event) => setConfirmSamples(Number(event.target.value))}
            onFocus={fieldProps.onFocus}
            onBlur={() => {
              fieldProps.onBlur();
              commitConfirm(confirmSamples);
            }}
          />
          <span className="font-mono text-xs text-muted-foreground">{t("unit.polls")}</span>
        </SettingRow>
        <SettingRow label={t("field.retries")} description={t("field.retries.hint")} align="top">
          <Input
            id="polling-retries"
            aria-label={t("field.retries")}
            type="number"
            className="w-20 text-right font-mono"
            value={maxRetries}
            onChange={(event) => {
              const value = Number(event.target.value);
              setRetries(value);
              schedulePolling({ intervalMinutes: interval, requestTimeoutSeconds: timeout, maxRetries: value });
            }}
            onFocus={fieldProps.onFocus}
            onBlur={() => {
              fieldProps.onBlur();
              commitPolling({ intervalMinutes: interval, requestTimeoutSeconds: timeout, maxRetries });
            }}
          />
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
              // A live mute outranks "enabled" here: both describe whether the
              // provider will say anything, and the mute is the one with an end
              // the operator wants to read.
              meta={
                isMuted(service.mutedUntil)
                  ? t("service.muted-until", { when: formatRelative(i18n.language, service.mutedUntil ?? "") })
                  : t(service.enabled ? "service.enabled" : "service.disabled")
              }
            >
              {/* Taking a provider out of the rotation is not deleting it:
                  the poller already skips a disabled service, and this is
                  the only place in the dashboard that can set the flag. */}
              <Switch
                aria-label={`${service.name} — ${t(service.enabled ? "service.enabled" : "service.disabled")}`}
                checked={service.enabled}
                onCheckedChange={(next) => servicePatch.mutate({ id: service.id, patch: { enabled: next } })}
              />
              {/* The variants are the ones these two buttons already carry — the
                  row shape changes, the actions do not. */}
              <MuteMenu service={service} />
              {/* Beside Edit rather than in the Providers table: an operator
                  looking at why a page will not parse is already in this row. */}
              <AdapterDebugDialog service={service} />
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

      {/* Only while something is restorable: an empty "recently removed" card
          would be permanent chrome for a state that is normally absent. */}
      {removed.length > 0 && (
        <SettingsSection
          title={t("settings.section.removed")}
          note={t("settings.removed-note")}
          delay={stagger(2, SECTION_CASCADE)}
        >
          {removed.map((service) => (
            <SettingRow
              key={service.id}
              className="service-row"
              label={service.name}
              description={`${service.adapter} · ${hostOf(service.baseUrl)}`}
              meta={t("providers.restore-until", {
                when: formatRelative(i18n.language, service.restoreUntil),
              })}
            >
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={serviceRestore.isPending}
                onClick={() => serviceRestore.mutate(service.id)}
              >
                {t("action.restore")}
              </Button>
              {/* The destructive half: everything the removal's confirmation
                  named goes now instead of when the window closes. */}
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={servicePurge.isPending}
                onClick={() => servicePurge.mutate(service.id)}
              >
                {t("action.remove-now")}
              </Button>
            </SettingRow>
          ))}
        </SettingsSection>
      )}

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
        <SettingRow
          label={t("settings.routing")}
          description={t("settings.routing.hint")}
          meta={t("settings.routing.count", { count: config.routing.rules.length })}
          align="top"
        >
          <RoutingRulesDialog
            routing={config.routing}
            channels={config.channels}
            services={config.services}
            quietHours={delivery.quietHours}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title={t("settings.section.delivery")}
        note={t("settings.delivery.note")}
        status={
          deliveryStatus === undefined ? undefined : (
            <span
              className={deliveryStatus.tone === "error" ? "text-destructive" : "text-[var(--status-operational)]"}
            >
              {deliveryStatus.text}
            </span>
          )
        }
        delay={stagger(3, SECTION_CASCADE)}
      >
        <SettingRow label={t("field.quiet-hours")} description={t("field.quiet-hours.hint")} align="top">
          <Switch
            id="quiet-hours"
            aria-label={t("field.quiet-hours")}
            checked={delivery.quietHours.enabled}
            onCheckedChange={(next) => commitDelivery({ quietHours: { enabled: next } })}
          />
        </SettingRow>

        {/* Only while the window is on, like the adaptive cadence above: four
            fields that change nothing are four questions with no answer. */}
        <Reveal open={delivery.quietHours.enabled}>
            <SettingRow label={t("field.quiet-hours.from")} align="top">
              <Input
                id="quiet-hours-start"
                aria-label={t("field.quiet-hours.from")}
                type="time"
                className="w-28 font-mono"
                value={delivery.quietHours.start}
                onFocus={fieldProps.onFocus}
                onBlur={fieldProps.onBlur}
                // A time input hands over a complete "HH:MM" or an empty
                // string, never a half-typed one, so this applies on change
                // like a switch rather than on blur like a number.
                onChange={(event) => {
                  if (event.target.value === "") return;
                  commitDelivery({ quietHours: { start: event.target.value } });
                }}
              />
            </SettingRow>
            <SettingRow label={t("field.quiet-hours.to")} align="top">
              <Input
                id="quiet-hours-end"
                aria-label={t("field.quiet-hours.to")}
                type="time"
                className="w-28 font-mono"
                value={delivery.quietHours.end}
                onFocus={fieldProps.onFocus}
                onBlur={fieldProps.onBlur}
                onChange={(event) => {
                  if (event.target.value === "") return;
                  commitDelivery({ quietHours: { end: event.target.value } });
                }}
              />
            </SettingRow>
            <SettingRow
              label={t("field.quiet-hours.zone")}
              description={t("field.quiet-hours.zone.hint")}
              align="top"
            >
              {/* The server's zone, not the browser's: the window is read where
                  the dispatcher runs, so "auto" here has to mean the container. */}
              <Select
                value={delivery.quietHours.timeZone}
                onValueChange={(value) => commitDelivery({ quietHours: { timeZone: value } })}
              >
                <SelectTrigger id="quiet-hours-zone" className="w-56" aria-label={t("field.quiet-hours.zone")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t("timezone.server")}</SelectItem>
                  {TIME_ZONES.map((zone) => (
                    <SelectItem key={zone} value={zone}>
                      {zone === "UTC" ? t("settings.timezone.utc") : zone.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingRow label={t("field.quiet-hours.floor")} align="top">
              <FloorSelect
                id="quiet-hours-floor"
                label={t("field.quiet-hours.floor")}
                value={delivery.quietHours.minSeverity}
                onChange={(value) => commitDelivery({ quietHours: { minSeverity: value } })}
              />
            </SettingRow>
        </Reveal>

        <SettingRow label={t("field.digest")} description={t("field.digest.hint")} align="top">
          <Switch
            id="digest-mode"
            aria-label={t("field.digest")}
            checked={delivery.digest.enabled}
            onCheckedChange={(next) => commitDelivery({ digest: { enabled: next } })}
          />
        </SettingRow>

        <Reveal open={delivery.digest.enabled}>
            <SettingRow label={t("field.digest.window")} align="top">
              <Input
                id="digest-window"
                aria-label={t("field.digest.window")}
                type="number"
                className="w-20 text-right font-mono"
                value={digestWindow}
                onChange={(event) => setDigestWindow(Number(event.target.value))}
                onFocus={fieldProps.onFocus}
                onBlur={() => {
                  fieldProps.onBlur();
                  commitDeliveryNumber("windowMinutes", digestWindow);
                }}
              />
              <span className="font-mono text-xs text-muted-foreground">{t("unit.minutes")}</span>
            </SettingRow>
            <SettingRow label={t("field.digest.floor")} align="top">
              <FloorSelect
                id="digest-floor"
                label={t("field.digest.floor")}
                value={delivery.digest.immediateFloor}
                onChange={(value) => commitDelivery({ digest: { immediateFloor: value } })}
              />
            </SettingRow>
        </Reveal>

        <SettingRow label={t("field.cap")} description={t("field.cap.hint")} align="top">
          <Switch
            id="alert-cap"
            aria-label={t("field.cap")}
            checked={delivery.cap.enabled}
            onCheckedChange={(next) => commitDelivery({ cap: { enabled: next } })}
          />
        </SettingRow>

        <Reveal open={delivery.cap.enabled}>
          <SettingRow label={t("field.cap.max")} align="top">
            <Input
              id="alert-cap-max"
              aria-label={t("field.cap.max")}
              type="number"
              className="w-20 text-right font-mono"
              value={capPerHour}
              onChange={(event) => setCapPerHour(Number(event.target.value))}
              onFocus={fieldProps.onFocus}
              onBlur={() => {
                fieldProps.onBlur();
                commitDeliveryNumber("maxPerHour", capPerHour);
              }}
            />
          </SettingRow>
        </Reveal>

        <SettingRow
          label={t("field.update-in-place")}
          description={t("field.update-in-place.hint")}
          align="top"
        >
          <Switch
            id="update-in-place"
            aria-label={t("field.update-in-place")}
            checked={delivery.updateInPlace}
            onCheckedChange={(next) => commitDelivery({ updateInPlace: next })}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title={t("settings.section.data")}
        status={
          retentionStatus === undefined ? undefined : (
            <span
              className={retentionStatus.tone === "error" ? "text-destructive" : "text-[var(--status-operational)]"}
            >
              {retentionStatus.text}
            </span>
          )
        }
        delay={stagger(4, SECTION_CASCADE)}
      >
        <SettingRow
          label={t("field.retention")}
          description={
            <>
              {t("field.retention.hint")}
              {/* The number that makes the choice a decision rather than a
                  guess: what this window costs, beside what the database
                  already weighs. */}
              <span data-testid="retention-cost" className="mt-0.5 block font-mono">
                {storage === undefined
                  ? "—"
                  : t(storage.measured ? "settings.retention.cost" : "settings.retention.cost-estimated", {
                      projected: formatBytes(
                        i18n.language,
                        storage.bytesPerSample * storage.samplesPerDay * retentionDays,
                      ),
                      current: formatBytes(i18n.language, storage.dbBytes),
                    })}
              </span>
            </>
          }
          align="top"
        >
          <Input
            id="retention-days"
            aria-label={t("field.retention")}
            type="number"
            className="w-20 text-right font-mono"
            value={retentionDays}
            onChange={(event) => setRetentionDays(Number(event.target.value))}
            onFocus={fieldProps.onFocus}
            onBlur={() => {
              fieldProps.onBlur();
              commitRetention(retentionDays);
            }}
          />
          <span className="font-mono text-xs text-muted-foreground">{t("unit.days")}</span>
        </SettingRow>
      </SettingsSection>

        {/* Roadmap 4.3. Everything above is configurable here and nowhere else,
            which until now meant it lived only inside one SQLite file. The
            export is a Light edition config.yml — a backup and a migration
            path in the same file — and the import is that file read back. */}
        <SettingRow
          label={t("settings.backup.label")}
          description={
            <>
              {t("settings.backup.hint")}
              {importStatus !== undefined && (
                <span
                  className={`mt-0.5 block ${
                    importStatus.tone === "error" ? "text-destructive" : "text-[var(--status-operational)]"
                  }`}
                >
                  {importStatus.text}
                </span>
              )}
            </>
          }
          align="top"
        >
          <Button asChild variant="outline" size="sm">
            <a href="/config/export">{t("settings.backup.export")}</a>
          </Button>
          {/* A real, focusable file input rather than a hidden one behind a
              button: a hidden input is out of the tab order, which is exactly
              the kind of control 5.13 exists to stop adding. */}
          <Input
            id="config-import"
            type="file"
            accept=".yml,.yaml,text/yaml"
            aria-label={t("settings.backup.import")}
            className="h-8 w-56 cursor-pointer py-1 text-xs"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void runImport(file);
              // Cleared so picking the same file twice fires twice: a retry
              // after fixing the file is the common second pick.
              event.target.value = "";
            }}
          />
        </SettingRow>

      <SettingsSection title={t("settings.section.appearance")} delay={stagger(5, SECTION_CASCADE)}>
        <SettingRow
          label={t("settings.timezone.label")}
          description={t("settings.timezone.hint", { zone: effectiveTimeZone() })}
          align="top"
        >
          <Select
            value={preferences?.timeZone ?? "auto"}
            onValueChange={(value) => {
              // Applied here as well as stored: the mutation only writes the
              // preference back, and the formatters read the module value.
              setTimeZone(value);
              patchPreferences.mutate({ timeZone: value });
            }}
          >
            <SelectTrigger id="time-zone" className="w-56" aria-label={t("settings.timezone.label")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t("settings.timezone.auto")}</SelectItem>
              {TIME_ZONES.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone === "UTC" ? t("settings.timezone.utc") : zone.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
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
