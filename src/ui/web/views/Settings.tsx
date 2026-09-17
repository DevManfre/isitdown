import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { ServiceDialog } from "@/components/ServiceDialog.tsx";
import { SettingRow } from "@/components/SettingRow.tsx";
import { SettingsSection } from "@/components/SettingsSection.tsx";
import { SECTION_REELS } from "@/components/settings/reels.ts";
import { SettingsLauncher } from "@/components/settings/SettingsLauncher.tsx";
import { openCategory, SETTINGS_CATEGORIES } from "@/components/settings/sectionIndex.ts";
import { Reveal } from "@/components/settings/Reveal.tsx";
import { ChannelRow, ChannelSummary, channelRank } from "@/components/settings/ChannelRow.tsx";
import { InstallAppRow } from "@/components/settings/InstallAppRow.tsx";
import { NumberSetting } from "@/components/settings/NumberSetting.tsx";
import { RoutingRulesDialog } from "@/components/settings/RoutingRulesDialog.tsx";
import { ServiceRow } from "@/components/settings/ServiceRow.tsx";
import {
  SettingsChromeProvider,
  SettingsToolbar,
  useSettingsChrome,
  useSettingVisible,
} from "@/components/settings/SettingsChrome.tsx";
import { SettingsNav } from "@/components/settings/SettingsNav.tsx";
import { SettingsToastsProvider, useSettingsToastReport } from "@/components/settings/SettingsToasts.tsx";
import {
  useConfig,
  useConfigImport,
  usePreferences,
  usePreferencesMutation,
  useServiceMutations,
  useSettingsMutation,
  useStorage,
  useRestoreBackup,
  useStorageMaintenance,
} from "@/hooks/queries.ts";
import { useFieldProps } from "@/hooks/useBusy.tsx";
import { formatBytes, formatRelative, hostOf } from "@/lib/format.ts";
import { isMuted } from "@/lib/mute.ts";
import { localeName, supportedLocales, switchLocale } from "@/lib/i18n.ts";
import { effectiveTimeZone, setTimeZone, TIME_ZONES } from "@/lib/timeZone.ts";
import { stagger } from "@/lib/stagger.ts";
import type { DeliveryPolicy, DescribedChannel, MapView, ServiceDefinition, SeverityFloorName } from "@/lib/types.ts";
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


/** Which providers the services card lists — the state, not the search. */
type ServiceFilter = "all" | "enabled" | "disabled" | "muted";

const SERVICE_FILTERS: { id: ServiceFilter; labelKey: string; of: (service: ServiceDefinition) => boolean }[] = [
  { id: "all", labelKey: "service.filter.all", of: () => true },
  { id: "enabled", labelKey: "service.filter.enabled", of: (service) => service.enabled },
  { id: "disabled", labelKey: "service.filter.disabled", of: (service) => !service.enabled },
  { id: "muted", labelKey: "service.filter.muted", of: (service) => isMuted(service.mutedUntil) },
];

/**
 * A channel row the page's filter can take off the page. `ChannelRow` is shared
 * with nothing else, but it is long enough that giving it a second job — being
 * searchable — belongs out here rather than inside it.
 */
function FilterableChannel({
  channel,
  open,
  onOpenChange,
}: {
  channel: DescribedChannel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const visible = useSettingVisible(`${channel.id} ${channel.fields.map((field) => field.name).join(" ")}`);
  if (!visible) return null;
  return <ChannelRow channel={channel} open={open} onOpenChange={onOpenChange} />;
}

function SettingsView() {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const { query, counts } = useSettingsChrome();
  const { data: config } = useConfig();
  const { data: preferences } = usePreferences();
  const patchPreferences = usePreferencesMutation();
  const settingsMutation = useSettingsMutation();
  const { data: storage } = useStorage();
  const storageMaintenance = useStorageMaintenance();
  const restoreBackup = useRestoreBackup();
  const configImport = useConfigImport();
  const { restore: serviceRestore, purge: servicePurge } = useServiceMutations();
  // Above the early return below: a hook cannot be called conditionally.
  const fieldProps = useFieldProps();

  const [interval_, setInterval_] = useState<number | undefined>(undefined);
  const [timeout_, setTimeout_] = useState<number | undefined>(undefined);
  const [retries, setRetries] = useState<number | undefined>(undefined);
  // Every instant-apply answer on this page — receipt or refusal — leaves as a
  // card in the bottom-right stack rather than a line in the card that saved.
  const toast = useSettingsToastReport();
  /** The receipt every plain write leaves, and the refusal when one fails. */
  const receipt = (kind: Parameters<typeof toast>[0], text?: string) => ({
    onSuccess: () => toast(kind, { text: text ?? t("settings.saved"), tone: "ok" as const }),
    onError: (error: unknown) =>
      toast(kind, {
        text: t("toast.failed", { error: error instanceof Error ? error.message : String(error) }),
        tone: "error" as const,
      }),
  });
  const [adaptiveInterval_, setAdaptiveInterval] = useState<number | undefined>(undefined);
  const [confirmSamples_, setConfirmSamples] = useState<number | undefined>(undefined);
  const [retentionDays_, setRetentionDays] = useState<number | undefined>(undefined);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [openChannel, setOpenChannel] = useState<string | undefined>(undefined);
  // One provider's actions open at a time, same rule as the channel rows: every
  // row expanded is the layout this replaced.
  const [openService, setOpenService] = useState<string | undefined>(undefined);
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>("all");
  // Ten channels, seven of them typically never configured. The list leads with
  // what can actually send and keeps the rest behind one row.
  const [showAllChannels, setShowAllChannels] = useState(false);
  const [digestWindow_, setDigestWindow] = useState<number | undefined>(undefined);
  const [capPerHour_, setCapPerHour] = useState<number | undefined>(undefined);

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
  // The state chips filter the list; the search field above filters the rows
  // inside it. They compose — "muted" and "cloud" together is a fair question.
  const stateFilter = SERVICE_FILTERS.find((entry) => entry.id === serviceFilter);
  const shownServices = stateFilter === undefined ? config.services : config.services.filter(stateFilter.of);
  // Rank 2 is "its environment variables are not set" — a channel that has
  // never been configured, which is most of the ten on a typical instance.
  const rankedChannels = [...config.channels].sort((a, b) => channelRank(a) - channelRank(b));
  const unsetChannels = rankedChannels.filter((channel) => channelRank(channel) === 2).length;
  const shownChannels =
    showAllChannels || query.trim() !== ""
      ? rankedChannels
      : rankedChannels.filter((channel) => channelRank(channel) < 2);
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
    toast("delivery", undefined);
    settingsMutation.mutate(
      { delivery: patch },
      {
        onSuccess: () => toast("delivery", { text: t("settings.saved"), tone: "ok" }),
        onError: (error) =>
          toast("delivery", { text: error instanceof Error ? error.message : String(error), tone: "error" }),
      },
    );
  };

  /** Bounds-checked before it is sent, for the same reason the engine's numbers are. */
  const commitDeliveryNumber = (field: keyof typeof DELIVERY_BOUNDS, value: number): void => {
    const bound = DELIVERY_BOUNDS[field];
    if (!Number.isInteger(value) || value < bound.min || value > bound.max) {
      toast("delivery", {
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
        toast("engine", {
          text: t("settings.out-of-range", { field: t(bound.labelKey), min: bound.min, max: bound.max }),
          tone: "error",
        });
        return;
      }
    }

    toast("engine", undefined);
    settingsMutation.mutate(next, {
      onSuccess: () => toast("engine", { text: t("settings.saved"), tone: "ok" }),
      onError: (error) =>
        toast("engine", { text: error instanceof Error ? error.message : String(error), tone: "error" }),
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
      toast("engine", {
        text: t("settings.out-of-range", {
          field: t("field.adaptive-interval"),
          min: ADAPTIVE_BOUNDS.min,
          max: ADAPTIVE_BOUNDS.max,
        }),
        tone: "error",
      });
      return;
    }
    toast("engine", undefined);
    settingsMutation.mutate(patch, {
      onSuccess: () => toast("engine", { text: t("settings.saved"), tone: "ok" }),
      onError: (error) =>
        toast("engine", { text: error instanceof Error ? error.message : String(error), tone: "error" }),
    });
  };

  const commitConfirm = (samples: number): void => {
    if (!Number.isInteger(samples) || samples < CONFIRM_BOUNDS.min || samples > CONFIRM_BOUNDS.max) {
      toast("engine", {
        text: t("settings.out-of-range", {
          field: t("field.confirm-samples"),
          min: CONFIRM_BOUNDS.min,
          max: CONFIRM_BOUNDS.max,
        }),
        tone: "error",
      });
      return;
    }
    toast("engine", undefined);
    settingsMutation.mutate({ confirmSamples: samples }, {
      onSuccess: () => toast("engine", { text: t("settings.saved"), tone: "ok" }),
      onError: (error) =>
        toast("engine", { text: error instanceof Error ? error.message : String(error), tone: "error" }),
    });
  };

  /**
   * Reads the picked file and hands it to the server as it stands (roadmap
   * 4.3): the validation that matters is the file schema's, and it lives on the
   * server where the Light edition's loader already is.
   */
  const runImport = async (file: File): Promise<void> => {
    toast("data", undefined);
    try {
      const report = await configImport.mutateAsync(await file.text());
      toast("data", {
        text: t("settings.backup.imported", {
          added: report.added.length,
          updated: report.updated.length,
          removed: report.removed.length,
        }),
        tone: "ok",
      });
    } catch (error) {
      toast("data", { text: error instanceof Error ? error.message : String(error), tone: "error" });
    }
  };

  /**
   * Roadmap 4.4. The one destructive control on this page: it replaces every row
   * this edition stores. Confirmed in the browser's own dialog, for the same
   * reason removing a provider is — the alternative is a second dialog
   * component for a button nobody presses twice a year.
   */
  const runRestore = async (file: File): Promise<void> => {
    toast("data", undefined);
    if (!window.confirm(t("settings.restore.confirm", { file: file.name }))) return;
    try {
      const report = await restoreBackup.mutateAsync(file);
      const rows = Object.values(report.tables).reduce((total, count) => total + count, 0);
      toast("data", {
        text: t("settings.restore.done", { providers: report.tables["services"] ?? 0, rows }),
        tone: "ok",
      });
    } catch (error) {
      toast("data", { text: error instanceof Error ? error.message : String(error), tone: "error" });
    }
  };

  /**
   * Roadmap 6.13. The report is rendered rather than the query re-read for the
   * figure: `reclaimed` is a number only the run knows — the storage report
   * before and after it are two sizes, and subtracting them here would be a
   * second definition of what a vacuum returned.
   */
  const runMaintenance = (): void => {
    toast("data", undefined);
    storageMaintenance.mutate(undefined, {
      onSuccess: (report) => {
        if (!report.ok) {
          toast("data", {
            text: t("settings.maintenance.failed", { integrity: report.integrity }),
            tone: "error",
          });
          return;
        }
        const current = formatBytes(i18n.language, report.bytesAfter);
        toast("data", {
          text:
            report.reclaimed === 0
              ? t("settings.maintenance.nothing", { current })
              : t("settings.maintenance.reclaimed", {
                  reclaimed: formatBytes(i18n.language, report.reclaimed),
                  current,
                }),
          tone: "ok",
        });
      },
      onError: (error) =>
        toast("data", { text: error instanceof Error ? error.message : String(error), tone: "error" }),
    });
  };

  const commitRetention = (days: number): void => {
    if (!Number.isInteger(days) || days < RETENTION_BOUNDS.min || days > RETENTION_BOUNDS.max) {
      toast("data", {
        text: t("settings.out-of-range", {
          field: t("field.retention"),
          min: RETENTION_BOUNDS.min,
          max: RETENTION_BOUNDS.max,
        }),
        tone: "error",
      });
      return;
    }
    toast("data", undefined);
    settingsMutation.mutate(
      { retentionDays: days },
      {
        onSuccess: () => toast("data", { text: t("settings.saved"), tone: "ok" }),
        onError: (error) =>
          toast("data", { text: error instanceof Error ? error.message : String(error), tone: "error" }),
      },
    );
  };

  // The launcher grid, or one category's rows. The category comes from the URL
  // rather than component state, so a category is a place: it can be linked to,
  // reloaded, and left with the browser's own back button.
  const open = openCategory(pathname);
  const categories = SETTINGS_CATEGORIES.filter(
    // "Recently removed" is a category only while something is restorable.
    (category) => category.id !== "removed" || removed.length > 0,
  );

  return (
    // Not centred as a pair: the rail belongs against the view's own left
    // edge, under the page title, rather than floating in the gutter between
    // the sidebar and a centred column.
    <div className="flex w-full gap-10">
      {open !== undefined && <SettingsNav categories={categories} active={open} />}

      {/* The rows read as prose, so they stay capped at a comfortable
          measure; the launcher grid is tiles, not prose, and takes the
          whole width it is given. */}
      <div className={`flex min-w-0 flex-1 flex-col gap-8 ${open === undefined ? "" : "max-w-5xl"}`}>
      {/* The subtitle moved into the rail (SettingsNav), where it stays in view
          for the whole page rather than scrolling off above the first section.
          Below the `lg` breakpoint the rail is hidden, so it is said here
          instead — the sentence is never absent, only ever in one place. */}
      <div className="flex flex-col gap-3">
        <span className="text-xs leading-relaxed text-muted-foreground lg:hidden">
          {t("settings.subtitle")}
        </span>
        {open === undefined ? (
          <SettingsToolbar density={false} />
        ) : (
          <div className="flex flex-col gap-3">
            <Link
              to="/settings"
              className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("settings.back")}
            </Link>
            <SettingsToolbar />
          </div>
        )}
      </div>

      {open === undefined && (
        <SettingsLauncher categories={categories} query={query} counts={{ services: config.services.length }} />
      )}

      {open === "engine" && (
      <SettingsSection
        id="engine"
        reel={SECTION_REELS.engine}
        className="lg:col-span-6"
        title={t("settings.section.engine")}
        delay={stagger(0, SECTION_CASCADE)}
      >
        <SettingRow label={t("field.interval")} description={t("field.interval.hint")} align="top">
          <NumberSetting
            id="polling-interval"
            label={t("field.interval")}
            unit={t("unit.minutes")}
            min={POLLING_BOUNDS.intervalMinutes.min}
            max={POLLING_BOUNDS.intervalMinutes.max}
            value={interval}
            onChange={(value) => {
              setInterval_(value);
              schedulePolling({ intervalMinutes: value, requestTimeoutSeconds: timeout, maxRetries });
            }}
            onCommit={(value) =>
              commitPolling({ intervalMinutes: value, requestTimeoutSeconds: timeout, maxRetries })
            }
            onFocus={fieldProps.onFocus}
            onBlur={fieldProps.onBlur}
          />
        </SettingRow>
        <SettingRow label={t("field.timeout")} description={t("field.timeout.hint")} align="top">
          <NumberSetting
            id="polling-timeout"
            label={t("field.timeout")}
            unit={t("unit.seconds")}
            min={POLLING_BOUNDS.requestTimeoutSeconds.min}
            max={POLLING_BOUNDS.requestTimeoutSeconds.max}
            value={timeout}
            onChange={(value) => {
              setTimeout_(value);
              schedulePolling({ intervalMinutes: interval, requestTimeoutSeconds: value, maxRetries });
            }}
            onCommit={(value) =>
              commitPolling({ intervalMinutes: interval, requestTimeoutSeconds: value, maxRetries })
            }
            onFocus={fieldProps.onFocus}
            onBlur={fieldProps.onBlur}
          />
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
            <NumberSetting
              id="adaptive-interval"
              label={t("field.adaptive-interval")}
              unit={t("unit.minutes")}
              min={ADAPTIVE_BOUNDS.min}
              max={ADAPTIVE_BOUNDS.max}
              value={adaptiveInterval}
              onChange={setAdaptiveInterval}
              onCommit={(value) => commitAdaptive({ adaptiveIntervalMinutes: value })}
              onFocus={fieldProps.onFocus}
              onBlur={fieldProps.onBlur}
            />
          </SettingRow>
        </Reveal>
        <SettingRow
          label={t("field.confirm-samples")}
          description={t("field.confirm-samples.hint")}
          align="top"
        >
          <NumberSetting
            id="confirm-samples"
            label={t("field.confirm-samples")}
            unit={t("unit.polls")}
            min={CONFIRM_BOUNDS.min}
            max={CONFIRM_BOUNDS.max}
            value={confirmSamples}
            onChange={setConfirmSamples}
            onCommit={commitConfirm}
            onFocus={fieldProps.onFocus}
            onBlur={fieldProps.onBlur}
          />
        </SettingRow>
        <SettingRow label={t("field.retries")} description={t("field.retries.hint")} align="top">
          <NumberSetting
            id="polling-retries"
            label={t("field.retries")}
            min={POLLING_BOUNDS.maxRetries.min}
            max={POLLING_BOUNDS.maxRetries.max}
            value={maxRetries}
            onChange={(value) => {
              setRetries(value);
              schedulePolling({ intervalMinutes: interval, requestTimeoutSeconds: timeout, maxRetries: value });
            }}
            onCommit={(value) =>
              commitPolling({ intervalMinutes: interval, requestTimeoutSeconds: timeout, maxRetries: value })
            }
            onFocus={fieldProps.onFocus}
            onBlur={fieldProps.onBlur}
          />
        </SettingRow>
      </SettingsSection>
      )}

      {open === "services" && (
      <SettingsSection
        id="services"
        reel={SECTION_REELS.services}
        // The services list gives up two columns to "Recently removed" only while
        // something is restorable; on its own it takes the whole row rather
        // than leaving a hole beside itself.
        className={removed.length > 0 ? "lg:col-span-4" : "lg:col-span-6"}
        title={t("settings.section.services")}
        action={<ServiceDialog mode="add" trigger={<Button type="button" size="sm">{t("action.add-service")}</Button>} />}
        delay={stagger(1, SECTION_CASCADE)}
      >
        {config.services.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{t("providers.empty")}</p>
        ) : (
          <div className="flex flex-col">
            {/* The other half of what the filter field cannot answer: typing a
                name finds one provider, and this finds the ones whose state is
                the question — which of them am I currently hearing nothing
                from, and why. The counts are on the chips because "muted: 0"
                is itself the answer often enough. */}
            <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5">
              {SERVICE_FILTERS.map((filter) => (
                <Button
                  key={filter.id}
                  type="button"
                  size="sm"
                  variant={serviceFilter === filter.id ? "secondary" : "ghost"}
                  aria-pressed={serviceFilter === filter.id}
                  className="h-7 rounded-full px-3 text-xs"
                  onClick={() => setServiceFilter(filter.id)}
                >
                  {t(filter.labelKey)}
                  <span className="font-mono text-[11px] tabular-nums opacity-70">
                    {config.services.filter(filter.of).length}
                  </span>
                </Button>
              ))}
            </div>
            <div className="flex flex-col divide-y divide-border border-t border-border">
              {shownServices.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">{t("service.filter.none")}</p>
              ) : (
                shownServices.map((service) => (
                  <ServiceRow
                    key={service.id}
                    service={service}
                    open={openService === service.id}
                    onOpenChange={(next) => setOpenService(next ? service.id : undefined)}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </SettingsSection>
      )}

      {/* Only while something is restorable: an empty "recently removed" card
          would be permanent chrome for a state that is normally absent — and
          the launcher drops its tile for the same reason. */}
      {open === "removed" && removed.length > 0 && (
        <SettingsSection
          id="removed"
          reel={SECTION_REELS.removed}
          className="lg:col-span-2"
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
                onClick={() =>
                  serviceRestore.mutate(
                    service.id,
                    receipt("services", t("toast.service.restored", { name: service.name })),
                  )
                }
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
                onClick={() =>
                  servicePurge.mutate(service.id, receipt("services", t("toast.service.purged", { name: service.name })))
                }
              >
                {t("action.remove-now")}
              </Button>
            </SettingRow>
          ))}
        </SettingsSection>
      )}

      {open === "notifications" && (
      <SettingsSection
        id="notifications"
        reel={SECTION_REELS.notifications}
        className="lg:col-span-3"
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
                every row expanded is the layout this replaced. Ten channels
                ship, and an instance typically configures two or three — the
                seven that have never been given a variable are a list of
                things that are not set up, so they wait behind one row. A
                typed filter overrides that: nothing is findable while it is
                hidden behind a disclosure. */}
            <div className="divide-y divide-border border-t border-border">
              {shownChannels.map((channel) => (
                <FilterableChannel
                  key={channel.id}
                  channel={channel}
                  open={openChannel === channel.id}
                  onOpenChange={(next) => setOpenChannel(next ? channel.id : undefined)}
                />
              ))}
            </div>
            {unsetChannels > 0 && query.trim() === "" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="my-1 self-start px-1 text-xs text-muted-foreground"
                onClick={() => setShowAllChannels((previous) => !previous)}
              >
                {showAllChannels
                  ? t("channel.show-configured")
                  : t("channel.show-all", { count: unsetChannels })}
              </Button>
            )}
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
      )}

      {open === "delivery" && (
      <SettingsSection
        id="delivery"
        reel={SECTION_REELS.delivery}
        className="lg:col-span-3"
        title={t("settings.section.delivery")}
        note={t("settings.delivery.note")}
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
              <NumberSetting
                id="digest-window"
                label={t("field.digest.window")}
                unit={t("unit.minutes")}
                min={DELIVERY_BOUNDS.windowMinutes.min}
                max={DELIVERY_BOUNDS.windowMinutes.max}
                value={digestWindow}
                onChange={setDigestWindow}
                onCommit={(value) => commitDeliveryNumber("windowMinutes", value)}
                onFocus={fieldProps.onFocus}
                onBlur={fieldProps.onBlur}
              />
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
            <NumberSetting
              id="alert-cap-max"
              label={t("field.cap.max")}
              unit={t("unit.per-hour")}
              min={DELIVERY_BOUNDS.maxPerHour.min}
              max={DELIVERY_BOUNDS.maxPerHour.max}
              value={capPerHour}
              onChange={setCapPerHour}
              onCommit={(value) => commitDeliveryNumber("maxPerHour", value)}
              onFocus={fieldProps.onFocus}
              onBlur={fieldProps.onBlur}
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
      )}

      {open === "data" && (
      <SettingsSection
        id="data"
        reel={SECTION_REELS.data}
        className="lg:col-span-3"
        title={t("settings.section.data")}
        delay={stagger(4, SECTION_CASCADE)}
      >
        <SettingRow
          label={t("field.retention")}
          description={t("field.retention.hint")}
          // The number that makes the choice a decision rather than a guess:
          // what this window costs, beside what the database already weighs.
          // A `status` rather than part of the hint, so compact density folds
          // the sentence away and leaves the figure.
          status={
            <span data-testid="retention-cost" className="block font-mono text-muted-foreground">
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
          }
          align="top"
        >
          <NumberSetting
            id="retention-days"
            label={t("field.retention")}
            unit={t("unit.days")}
            min={RETENTION_BOUNDS.min}
            max={RETENTION_BOUNDS.max}
            value={retentionDays}
            onChange={setRetentionDays}
            onCommit={commitRetention}
            onFocus={fieldProps.onFocus}
            onBlur={fieldProps.onBlur}
          />
        </SettingRow>

        {/* Roadmap 6.13. The row above says what the database weighs and the
            daily prune deletes rows out of it — but sqlite keeps their pages,
            so that figure never moved after a large prune. This is the button
            that returns them, with the integrity check that has to pass first. */}
        <SettingRow
          label={t("settings.maintenance.label")}
          description={t("settings.maintenance.hint")}
          align="top"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={storageMaintenance.isPending}
            onClick={runMaintenance}
          >
            {storageMaintenance.isPending ? t("settings.maintenance.running") : t("settings.maintenance.run")}
          </Button>
        </SettingRow>

        {/* Roadmap 4.3. Everything above is configurable here and nowhere else,
            which until now meant it lived only inside one SQLite file. The
            export is a Light edition config.yml — a backup and a migration
            path in the same file — and the import is that file read back. */}
        <SettingRow
          label={t("settings.backup.label")}
          description={t("settings.backup.hint")}
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

        {/* Roadmap 4.4. The row above carries the configuration; this one
            carries everything — history, incidents, the delivery log — because
            it is the database itself. What it does not carry is the credentials
            file beside it, which the hint says outright rather than leaving to
            be discovered on the day it matters. */}
        <SettingRow
          label={t("settings.restore.label")}
          description={t("settings.restore.hint")}
          align="top"
        >
          <Button asChild variant="outline" size="sm">
            <a href="/config/backup">{t("settings.restore.download")}</a>
          </Button>
          <Input
            id="db-restore"
            type="file"
            accept=".db,application/octet-stream"
            aria-label={t("settings.restore.upload")}
            disabled={restoreBackup.isPending}
            className="h-8 w-56 cursor-pointer py-1 text-xs"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void runRestore(file);
              event.target.value = "";
            }}
          />
        </SettingRow>
      </SettingsSection>
      )}

      {open === "appearance" && (
      <SettingsSection
        id="appearance"
        title={t("settings.section.appearance")}
        reel={SECTION_REELS.appearance}
        className="lg:col-span-3"
        delay={stagger(5, SECTION_CASCADE)}
      >
        {/* Language leads the section: it decides the words every other row on
            this page is read in, so it belongs above them rather than after.
            It used to sit in the header as six code pills; six is where that
            stopped being a glance and started being a row of chrome. */}
        <SettingRow
          label={t("settings.language.label")}
          description={t("settings.language.hint")}
          align="top"
        >
          <Select
            value={i18n.language}
            onValueChange={(value) => {
              // Applied here as well as stored, like the time zone beside it:
              // `switchLocale` is what actually changes the language, and the
              // mutation only remembers the choice for the next browser.
              void switchLocale(value).then((applied) =>
                patchPreferences.mutate({ uiLocale: applied }, receipt("appearance")),
              );
            }}
          >
            <SelectTrigger id="ui-locale" className="w-56" aria-label={t("settings.language.label")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {supportedLocales.map((locale) => (
                <SelectItem key={locale} value={locale}>
                  {localeName(locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
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
              patchPreferences.mutate({ timeZone: value }, receipt("appearance"));
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
            onValueChange={(value) => patchPreferences.mutate({ mapView: value as MapView }, receipt("appearance"))}
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
        {/* Roadmap 5.21. Last in Appearance: it is about the window the
            dashboard lives in rather than about what is drawn inside it. */}
        <InstallAppRow />
      </SettingsSection>
      )}

      {/* The filter can empty the category being read, and the launcher says so
          itself — this is the same sentence for the one open category. */}
      {open !== undefined && query.trim() !== "" && (counts[open] ?? 0) === 0 && (
        <p className="px-1 text-sm text-muted-foreground">{t("settings.filter.empty", { query: query.trim() })}</p>
      )}
      </div>
    </div>
  );
}

/**
 * The page, with the filter, the density switch and the section rail wrapped
 * around it — they are one piece of chrome shared by every section, and the
 * provider is what lets a row decide its own visibility without the query being
 * threaded through seven sections to reach it.
 */
export function Settings() {
  return (
    <SettingsToastsProvider>
      <SettingsChromeProvider>
        <SettingsView />
      </SettingsChromeProvider>
    </SettingsToastsProvider>
  );
}
