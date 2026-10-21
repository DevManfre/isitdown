import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { SettingRow } from "@/components/SettingRow.tsx";
import { SettingsSection } from "@/components/SettingsSection.tsx";
import { DELIVERY_OFF } from "@/components/settings/deliveryDefaults.ts";
import { NumberSetting } from "@/components/settings/NumberSetting.tsx";
import { Reveal } from "@/components/settings/Reveal.tsx";
import { SECTION_REELS } from "@/components/settings/reels.ts";
import { SECTION_CASCADE } from "@/components/settings/sectionCascade.ts";
import { useSettingsToastReport } from "@/components/settings/SettingsToasts.tsx";
import { useSettingsMutation } from "@/hooks/queries.ts";
import { useFieldProps } from "@/hooks/useBusy.tsx";
import { stagger } from "@/lib/stagger.ts";
import { TIME_ZONES } from "@/lib/timeZone.ts";
import type {
  DeliveryPolicy,
  RuntimeConfigResponse,
  SeverityFloorName,
} from "@/lib/types.ts";
// The floors come from core's own list rather than a copy: a floor added there
// has to appear here, and a literal array would silently not.
import { SEVERITY_FLOORS } from "../../../../core/routing.ts";

/** The two typed numbers in the delivery section, bounded like the engine's. */
const DELIVERY_BOUNDS = {
  windowMinutes: { min: 1, max: 1440, labelKey: "field.digest.window" },
  maxPerHour: { min: 1, max: 1000, labelKey: "field.cap.max" },
  leadMinutes: { min: 1, max: 10_080, labelKey: "field.maintenance-notice.lead" },
  afterMinutes: { min: 1, max: 1440, labelKey: "field.escalation.after" },
  afterFailures: { min: 2, max: 100, labelKey: "field.channel-health.after" },
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
    <Select
      value={value}
      onValueChange={(next) => onChange(next as SeverityFloorName)}
    >
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

/**
 * The channel an escalation goes to, picked from the ones that can send. A
 * channel the escalation still names but that has since been switched off stays
 * in the list: hiding it would show an empty choice for something that is set,
 * and the log already says the escalation cannot be sent.
 */
function ChannelSelect({
  id,
  label,
  value,
  channels,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  channels: { id: string; enabled: boolean }[];
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const options = channels.filter((channel) => channel.enabled || channel.id === value);
  return (
    // `{...(value === "" ? {} : { value })}` rather than `value={undefined}`:
    // an empty string is not a valid item value, and no value at all is what
    // lets the placeholder show for an escalation that has no channel yet.
    <Select {...(value === "" ? {} : { value })} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-56" aria-label={label}>
        <SelectValue placeholder={t("field.escalation.channel.placeholder")} />
      </SelectTrigger>
      <SelectContent>
        {options.map((channel) => (
          <SelectItem key={channel.id} value={channel.id}>
            {t(`channel.name.${channel.id}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * `delivery` is resolved by the view, not here: the notifications section reads
 * the quiet hours out of the same policy, so one resolved copy is passed to both.
 */
export function DeliverySection({
  config,
  delivery,
}: {
  config: RuntimeConfigResponse;
  delivery: DeliveryPolicy;
}) {
  const { t } = useTranslation();
  const settingsMutation = useSettingsMutation();
  const fieldProps = useFieldProps();
  const toast = useSettingsToastReport();
  const [digestWindow_, setDigestWindow] = useState<number | undefined>(
    undefined,
  );
  const [capPerHour_, setCapPerHour] = useState<number | undefined>(undefined);
  const [noticeLead_, setNoticeLead] = useState<number | undefined>(undefined);
  const [escalationAfter_, setEscalationAfter] = useState<number | undefined>(undefined);
  const [channelFailures_, setChannelFailures] = useState<number | undefined>(undefined);

  const digestWindow = digestWindow_ ?? delivery.digest.windowMinutes;
  const capPerHour = capPerHour_ ?? delivery.cap.maxPerHour;
  const maintenanceNotice = delivery.maintenanceNotice ?? DELIVERY_OFF.maintenanceNotice!;
  const noticeLead = noticeLead_ ?? maintenanceNotice.leadMinutes;
  const escalation = delivery.escalation ?? DELIVERY_OFF.escalation!;
  const escalationAfter = escalationAfter_ ?? escalation.afterMinutes;
  const channelHealth = delivery.channelHealth ?? DELIVERY_OFF.channelHealth!;
  const channelFailures = channelFailures_ ?? channelHealth.afterFailures;

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
    maintenanceNotice?: Partial<NonNullable<DeliveryPolicy["maintenanceNotice"]>>;
    escalation?: Partial<NonNullable<DeliveryPolicy["escalation"]>>;
    channelHealth?: Partial<NonNullable<DeliveryPolicy["channelHealth"]>>;
  }): void => {
    toast("delivery", undefined);
    settingsMutation.mutate(
      { delivery: patch },
      {
        onSuccess: () =>
          toast("delivery", { text: t("settings.saved"), tone: "ok" }),
        onError: (error) =>
          toast("delivery", {
            text: error instanceof Error ? error.message : String(error),
            tone: "error",
          }),
      },
    );
  };

  /** Bounds-checked before it is sent, for the same reason the engine's numbers are. */
  const commitDeliveryNumber = (
    field: keyof typeof DELIVERY_BOUNDS,
    value: number,
  ): void => {
    const bound = DELIVERY_BOUNDS[field];
    if (!Number.isInteger(value) || value < bound.min || value > bound.max) {
      toast("delivery", {
        text: t("settings.out-of-range", {
          field: t(bound.labelKey),
          min: bound.min,
          max: bound.max,
        }),
        tone: "error",
      });
      return;
    }
    commitDelivery(
      field === "windowMinutes"
        ? { digest: { windowMinutes: value } }
        : field === "leadMinutes"
          ? { maintenanceNotice: { leadMinutes: value } }
          : field === "afterMinutes"
            ? { escalation: { afterMinutes: value } }
            : field === "afterFailures"
              ? { channelHealth: { afterFailures: value } }
              : { cap: { maxPerHour: value } },
    );
  };

  return (
    <SettingsSection
      id="delivery"
      reel={SECTION_REELS.delivery}
      className="lg:col-span-3"
      title={t("settings.section.delivery")}
      note={t("settings.delivery.note")}
      delay={stagger(3, SECTION_CASCADE)}
    >
      <SettingRow
        label={t("field.quiet-hours")}
        description={t("field.quiet-hours.hint")}
        align="top"
      >
        <Switch
          id="quiet-hours"
          aria-label={t("field.quiet-hours")}
          checked={delivery.quietHours.enabled}
          onCheckedChange={(next) =>
            commitDelivery({ quietHours: { enabled: next } })
          }
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
              commitDelivery({
                quietHours: { start: event.target.value },
              });
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
            onValueChange={(value) =>
              commitDelivery({ quietHours: { timeZone: value } })
            }
          >
            <SelectTrigger
              id="quiet-hours-zone"
              className="w-56"
              aria-label={t("field.quiet-hours.zone")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t("timezone.server")}</SelectItem>
              {TIME_ZONES.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone === "UTC"
                    ? t("settings.timezone.utc")
                    : zone.replace(/_/g, " ")}
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
            onChange={(value) =>
              commitDelivery({ quietHours: { minSeverity: value } })
            }
          />
        </SettingRow>
      </Reveal>

      <SettingRow
        label={t("field.digest")}
        description={t("field.digest.hint")}
        align="top"
      >
        <Switch
          id="digest-mode"
          aria-label={t("field.digest")}
          checked={delivery.digest.enabled}
          onCheckedChange={(next) =>
            commitDelivery({ digest: { enabled: next } })
          }
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
            onCommit={(value) =>
              commitDeliveryNumber("windowMinutes", value)
            }
            onFocus={fieldProps.onFocus}
            onBlur={fieldProps.onBlur}
          />
        </SettingRow>
        <SettingRow label={t("field.digest.floor")} align="top">
          <FloorSelect
            id="digest-floor"
            label={t("field.digest.floor")}
            value={delivery.digest.immediateFloor}
            onChange={(value) =>
              commitDelivery({ digest: { immediateFloor: value } })
            }
          />
        </SettingRow>
      </Reveal>

      <SettingRow
        label={t("field.cap")}
        description={t("field.cap.hint")}
        align="top"
      >
        <Switch
          id="alert-cap"
          aria-label={t("field.cap")}
          checked={delivery.cap.enabled}
          onCheckedChange={(next) =>
            commitDelivery({ cap: { enabled: next } })
          }
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
            onCommit={(value) =>
              commitDeliveryNumber("maxPerHour", value)
            }
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
          onCheckedChange={(next) =>
            commitDelivery({ updateInPlace: next })
          }
        />
      </SettingRow>

      <SettingRow
        label={t("field.maintenance-notice")}
        description={t("field.maintenance-notice.hint")}
        align="top"
      >
        <Switch
          id="maintenance-notice"
          aria-label={t("field.maintenance-notice")}
          checked={maintenanceNotice.enabled}
          onCheckedChange={(next) =>
            commitDelivery({ maintenanceNotice: { enabled: next } })
          }
        />
      </SettingRow>

      <Reveal open={maintenanceNotice.enabled}>
        <SettingRow label={t("field.maintenance-notice.lead")} align="top">
          <NumberSetting
            id="maintenance-notice-lead"
            label={t("field.maintenance-notice.lead")}
            unit={t("unit.minutes")}
            min={DELIVERY_BOUNDS.leadMinutes.min}
            max={DELIVERY_BOUNDS.leadMinutes.max}
            value={noticeLead}
            onChange={setNoticeLead}
            onCommit={(value) =>
              commitDeliveryNumber("leadMinutes", value)
            }
            onFocus={fieldProps.onFocus}
            onBlur={fieldProps.onBlur}
          />
        </SettingRow>
      </Reveal>

      <SettingRow
        label={t("field.escalation")}
        description={t("field.escalation.hint")}
        align="top"
      >
        <Switch
          id="escalation"
          aria-label={t("field.escalation")}
          checked={escalation.enabled}
          onCheckedChange={(next) =>
            commitDelivery({ escalation: { enabled: next } })
          }
        />
      </SettingRow>

      <Reveal open={escalation.enabled}>
        <SettingRow label={t("field.escalation.after")} align="top">
          <NumberSetting
            id="escalation-after"
            label={t("field.escalation.after")}
            unit={t("unit.minutes")}
            min={DELIVERY_BOUNDS.afterMinutes.min}
            max={DELIVERY_BOUNDS.afterMinutes.max}
            value={escalationAfter}
            onChange={setEscalationAfter}
            onCommit={(value) =>
              commitDeliveryNumber("afterMinutes", value)
            }
            onFocus={fieldProps.onFocus}
            onBlur={fieldProps.onBlur}
          />
        </SettingRow>
        <SettingRow label={t("field.escalation.channel")} align="top">
          <ChannelSelect
            id="escalation-channel"
            label={t("field.escalation.channel")}
            value={escalation.channel}
            channels={config.channels}
            onChange={(value) =>
              commitDelivery({ escalation: { channel: value } })
            }
          />
        </SettingRow>
        <SettingRow label={t("field.escalation.floor")} align="top">
          <FloorSelect
            id="escalation-floor"
            label={t("field.escalation.floor")}
            value={escalation.minSeverity}
            onChange={(value) =>
              commitDelivery({ escalation: { minSeverity: value } })
            }
          />
        </SettingRow>
      </Reveal>

      <SettingRow
        label={t("field.channel-health")}
        description={t("field.channel-health.hint")}
        align="top"
      >
        <Switch
          id="channel-health"
          aria-label={t("field.channel-health")}
          checked={channelHealth.enabled}
          onCheckedChange={(next) =>
            commitDelivery({ channelHealth: { enabled: next } })
          }
        />
      </SettingRow>

      <Reveal open={channelHealth.enabled}>
        <SettingRow label={t("field.channel-health.after")} align="top">
          <NumberSetting
            id="channel-health-after"
            label={t("field.channel-health.after")}
            unit={t("unit.failures")}
            min={DELIVERY_BOUNDS.afterFailures.min}
            max={DELIVERY_BOUNDS.afterFailures.max}
            value={channelFailures}
            onChange={setChannelFailures}
            onCommit={(value) =>
              commitDeliveryNumber("afterFailures", value)
            }
            onFocus={fieldProps.onFocus}
            onBlur={fieldProps.onBlur}
          />
        </SettingRow>
      </Reveal>
    </SettingsSection>
  );
}
