import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch.tsx";
import { SettingRow } from "@/components/SettingRow.tsx";
import { SettingsSection } from "@/components/SettingsSection.tsx";
import { NumberSetting } from "@/components/settings/NumberSetting.tsx";
import { Reveal } from "@/components/settings/Reveal.tsx";
import { SECTION_REELS } from "@/components/settings/reels.ts";
import { SECTION_CASCADE } from "@/components/settings/sectionCascade.ts";
import { useSettingsToastReport } from "@/components/settings/SettingsToasts.tsx";
import { useSettingsMutation } from "@/hooks/queries.ts";
import { useFieldProps } from "@/hooks/useBusy.tsx";
import { stagger } from "@/lib/stagger.ts";
import type { RuntimeConfigResponse } from "@/lib/types.ts";

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

export function EngineSection({ config }: { config: RuntimeConfigResponse }) {
  const { t } = useTranslation();
  const settingsMutation = useSettingsMutation();
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

  return (
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
  );
}
