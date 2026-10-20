import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { ArrowLeft } from "lucide-react";
import { Switch } from "@/components/ui/switch.tsx";
import { SettingRow } from "@/components/SettingRow.tsx";
import { SettingsSection } from "@/components/SettingsSection.tsx";
import { SECTION_REELS } from "@/components/settings/reels.ts";
import { SECTION_CASCADE } from "@/components/settings/sectionCascade.ts";
import { AppearanceSection } from "@/components/settings/AppearanceSection.tsx";
import { SettingsLauncher } from "@/components/settings/SettingsLauncher.tsx";
import {
  openCategory,
  SETTINGS_CATEGORIES,
} from "@/components/settings/sectionIndex.ts";
import { Reveal } from "@/components/settings/Reveal.tsx";
import { NumberSetting } from "@/components/settings/NumberSetting.tsx";
import { DeliverySection } from "@/components/settings/DeliverySection.tsx";
import { DELIVERY_OFF } from "@/components/settings/deliveryDefaults.ts";
import { NotificationsSection } from "@/components/settings/NotificationsSection.tsx";
import { ServicesSection } from "@/components/settings/ServicesSection.tsx";
import { RemovedSection } from "@/components/settings/RemovedSection.tsx";
import { DataSection } from "@/components/settings/DataSection.tsx";
import {
  SettingsChromeProvider,
  SettingsToolbar,
  useSettingsChrome,
} from "@/components/settings/SettingsChrome.tsx";
import { SettingsNav } from "@/components/settings/SettingsNav.tsx";
import {
  SettingsToastsProvider,
  useSettingsToastReport,
} from "@/components/settings/SettingsToasts.tsx";
import {
  useConfig,
  usePreferences,
  useSettingsMutation,
  useStorage,
} from "@/hooks/queries.ts";
import { useFieldProps } from "@/hooks/useBusy.tsx";
import { stagger } from "@/lib/stagger.ts";
// The floors come from core's own list rather than a copy: a floor added there
// has to appear here, and a literal array would silently not.

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
function SettingsView() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { query, counts } = useSettingsChrome();
  const { data: config } = useConfig();
  const { data: preferences } = usePreferences();
  const settingsMutation = useSettingsMutation();
  const { data: storage } = useStorage();
  // Above the early return below: a hook cannot be called conditionally.
  const fieldProps = useFieldProps();

  const [interval_, setInterval_] = useState<number | undefined>(undefined);
  const [timeout_, setTimeout_] = useState<number | undefined>(undefined);
  const [retries, setRetries] = useState<number | undefined>(undefined);
  // Every instant-apply answer on this page — receipt or refusal — leaves as a
  // card in the bottom-right stack rather than a line in the card that saved.
  const toast = useSettingsToastReport();
  const [adaptiveInterval_, setAdaptiveInterval] = useState<number | undefined>(
    undefined,
  );
  const [confirmSamples_, setConfirmSamples] = useState<number | undefined>(
    undefined,
  );
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
  const adaptiveInterval =
    adaptiveInterval_ ?? config.polling.adaptiveIntervalMinutes ?? 1;
  // Defaulted for the same reason as the two above: a server from before flap
  // damping answers without the field, and one sample is what it was doing.
  const confirmSamples = confirmSamples_ ?? config.polling.confirmSamples ?? 1;
  // Defaulted rather than assumed: the section only exists when a removal is
  // waiting, and an older payload carries no list at all.
  const removed = config.removed ?? [];
  const delivery = config.delivery ?? DELIVERY_OFF;

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
          text: t("settings.out-of-range", {
            field: t(bound.labelKey),
            min: bound.min,
            max: bound.max,
          }),
          tone: "error",
        });
        return;
      }
    }

    toast("engine", undefined);
    settingsMutation.mutate(next, {
      onSuccess: () =>
        toast("engine", { text: t("settings.saved"), tone: "ok" }),
      onError: (error) =>
        toast("engine", {
          text: error instanceof Error ? error.message : String(error),
          tone: "error",
        }),
    });
  };

  const schedulePolling = (next: Parameters<typeof commitPolling>[0]): void => {
    if (debounce.current !== undefined) clearTimeout(debounce.current);
    debounce.current = setTimeout(
      () => commitPolling(next),
      POLLING_DEBOUNCE_MS,
    );
  };

  /**
   * The adaptive pair saves on its own rather than through `commitPolling`: the
   * switch is an instant apply with nothing to debounce, and sending the three
   * engine numbers along with it would write fields the operator did not touch.
   */
  const commitAdaptive = (patch: {
    adaptivePolling?: boolean;
    adaptiveIntervalMinutes?: number;
  }): void => {
    const minutes = patch.adaptiveIntervalMinutes;
    if (
      minutes !== undefined &&
      (!Number.isInteger(minutes) ||
        minutes < ADAPTIVE_BOUNDS.min ||
        minutes > ADAPTIVE_BOUNDS.max)
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
      onSuccess: () =>
        toast("engine", { text: t("settings.saved"), tone: "ok" }),
      onError: (error) =>
        toast("engine", {
          text: error instanceof Error ? error.message : String(error),
          tone: "error",
        }),
    });
  };

  const commitConfirm = (samples: number): void => {
    if (
      !Number.isInteger(samples) ||
      samples < CONFIRM_BOUNDS.min ||
      samples > CONFIRM_BOUNDS.max
    ) {
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
    settingsMutation.mutate(
      { confirmSamples: samples },
      {
        onSuccess: () =>
          toast("engine", { text: t("settings.saved"), tone: "ok" }),
        onError: (error) =>
          toast("engine", {
            text: error instanceof Error ? error.message : String(error),
            tone: "error",
          }),
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
      {open !== undefined && (
        <SettingsNav categories={categories} active={open} />
      )}

      {/* The rows read as prose, so they stay capped at a comfortable
          measure; the launcher grid is tiles, not prose, and takes the
          whole width it is given. */}
      <div
        className={`flex min-w-0 flex-1 flex-col gap-8 ${open === undefined ? "" : "max-w-5xl"}`}
      >
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
          <SettingsLauncher
            categories={categories}
            query={query}
            counts={{ services: config.services.length }}
          />
        )}

        {open === "engine" && (
          <SettingsSection
            id="engine"
            reel={SECTION_REELS.engine}
            className="lg:col-span-6"
            title={t("settings.section.engine")}
            delay={stagger(0, SECTION_CASCADE)}
          >
            <SettingRow
              label={t("field.interval")}
              description={t("field.interval.hint")}
              align="top"
            >
              <NumberSetting
                id="polling-interval"
                label={t("field.interval")}
                unit={t("unit.minutes")}
                min={POLLING_BOUNDS.intervalMinutes.min}
                max={POLLING_BOUNDS.intervalMinutes.max}
                value={interval}
                onChange={(value) => {
                  setInterval_(value);
                  schedulePolling({
                    intervalMinutes: value,
                    requestTimeoutSeconds: timeout,
                    maxRetries,
                  });
                }}
                onCommit={(value) =>
                  commitPolling({
                    intervalMinutes: value,
                    requestTimeoutSeconds: timeout,
                    maxRetries,
                  })
                }
                onFocus={fieldProps.onFocus}
                onBlur={fieldProps.onBlur}
              />
            </SettingRow>
            <SettingRow
              label={t("field.timeout")}
              description={t("field.timeout.hint")}
              align="top"
            >
              <NumberSetting
                id="polling-timeout"
                label={t("field.timeout")}
                unit={t("unit.seconds")}
                min={POLLING_BOUNDS.requestTimeoutSeconds.min}
                max={POLLING_BOUNDS.requestTimeoutSeconds.max}
                value={timeout}
                onChange={(value) => {
                  setTimeout_(value);
                  schedulePolling({
                    intervalMinutes: interval,
                    requestTimeoutSeconds: value,
                    maxRetries,
                  });
                }}
                onCommit={(value) =>
                  commitPolling({
                    intervalMinutes: interval,
                    requestTimeoutSeconds: value,
                    maxRetries,
                  })
                }
                onFocus={fieldProps.onFocus}
                onBlur={fieldProps.onBlur}
              />
            </SettingRow>
            <SettingRow
              label={t("field.adaptive")}
              description={t("field.adaptive.hint")}
              align="top"
            >
              <Switch
                id="adaptive-polling"
                aria-label={t("field.adaptive")}
                checked={adaptivePolling}
                onCheckedChange={(next) =>
                  commitAdaptive({ adaptivePolling: next })
                }
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
                  onCommit={(value) =>
                    commitAdaptive({ adaptiveIntervalMinutes: value })
                  }
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
            <SettingRow
              label={t("field.retries")}
              description={t("field.retries.hint")}
              align="top"
            >
              <NumberSetting
                id="polling-retries"
                label={t("field.retries")}
                min={POLLING_BOUNDS.maxRetries.min}
                max={POLLING_BOUNDS.maxRetries.max}
                value={maxRetries}
                onChange={(value) => {
                  setRetries(value);
                  schedulePolling({
                    intervalMinutes: interval,
                    requestTimeoutSeconds: timeout,
                    maxRetries: value,
                  });
                }}
                onCommit={(value) =>
                  commitPolling({
                    intervalMinutes: interval,
                    requestTimeoutSeconds: timeout,
                    maxRetries: value,
                  })
                }
                onFocus={fieldProps.onFocus}
                onBlur={fieldProps.onBlur}
              />
            </SettingRow>
          </SettingsSection>
        )}

        {open === "services" && (
          <ServicesSection
            services={config.services}
            removedCount={removed.length}
          />
        )}

        {/* Only while something is restorable: an empty "recently removed" card
          would be permanent chrome for a state that is normally absent — and
          the launcher drops its tile for the same reason. */}
        {open === "removed" && removed.length > 0 && (
          <RemovedSection removed={removed} />
        )}

        {open === "notifications" && (
          <NotificationsSection
            config={config}
            quietHours={delivery.quietHours}
          />
        )}

        {open === "delivery" && (
          <DeliverySection config={config} delivery={delivery} />
        )}

        {open === "data" && <DataSection config={config} storage={storage} />}

        {open === "appearance" && <AppearanceSection preferences={preferences} />}

        {/* The filter can empty the category being read, and the launcher says so
          itself — this is the same sentence for the one open category. */}
        {open !== undefined &&
          query.trim() !== "" &&
          (counts[open] ?? 0) === 0 && (
            <p className="px-1 text-sm text-muted-foreground">
              {t("settings.filter.empty", { query: query.trim() })}
            </p>
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
