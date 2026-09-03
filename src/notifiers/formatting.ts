import { formatUtc, t } from "../core/i18n/index.ts";
import type {
  NotificationPayload,
  OverallStatus,
  StatusChange,
  StatusChangeKind,
} from "../core/types.ts";

/**
 * Message assembly shared by every channel. Emoji and layout are formatting and
 * belong here rather than in the diff engine; the words themselves come from the
 * core catalogs. A new channel renders through `renderMessage` and only adapts
 * the transport, so channels can never drift apart in what they report.
 */

const EMOJI: Record<OverallStatus, string> = {
  operational: "🟢",
  degraded: "🟡",
  partial_outage: "🟠",
  major_outage: "🔴",
  unknown: "⚪",
};

// A declared maintenance window is its own affordance, not a severity: it
// never borrows the colour of the status it interrupts (or leaves behind).
const MAINTENANCE_EMOJI = "⚙️";

/**
 * The same severities the dashboard paints, for the channels that render a
 * coloured block rather than plain text. Mirrors the written set in
 * `src/ui/web/css/tokens.css` (`--status-*`, light theme): a Discord embed sits
 * on the reader's own background, so the darker written value reads on both.
 */
const COLOR: Record<OverallStatus, number> = {
  operational: 0x15803d,
  degraded: 0xa16207,
  partial_outage: 0xc2410c,
  major_outage: 0xb91c1c,
  unknown: 0x71717a,
};

// `--status-accent`: maintenance is planned work, not a severity.
const MAINTENANCE_COLOR = 0x473c9e;

const STATUS_KEY: Record<OverallStatus, string> = {
  operational: "status.operational",
  degraded: "status.degraded",
  partial_outage: "status.partial-outage",
  major_outage: "status.major-outage",
  unknown: "status.unknown",
};

const TEMPLATE: Record<StatusChangeKind, string> = {
  status_change: "notification.status.changed",
  component_status_change: "notification.component.changed",
  incident_opened: "notification.incident.opened",
  incident_updated: "notification.incident.updated",
  incident_resolved: "notification.incident.resolved",
  maintenance_started: "notification.maintenance.started",
  maintenance_ended: "notification.maintenance.ended",
  monitoring_degraded: "notification.monitoring.degraded",
};

export function emojiFor(status: OverallStatus): string {
  return EMOJI[status];
}

/**
 * A monitoring warning is about our own fetching, not the provider's state, so
 * it never borrows the provider's colour. A maintenance window is not a
 * severity either, so it gets its own fixed pair instead of the current
 * status's. Emoji and colour are decided here together so a channel that shows
 * both can never disagree with one that shows only the emoji.
 */
function accentFor(change: StatusChange): { emoji: string; color: number } {
  if (change.kind === "monitoring_degraded") {
    return { emoji: EMOJI.unknown, color: COLOR.unknown };
  }
  if (change.kind === "maintenance_started" || change.kind === "maintenance_ended") {
    return { emoji: MAINTENANCE_EMOJI, color: MAINTENANCE_COLOR };
  }
  return { emoji: emojiFor(change.currentStatus), color: COLOR[change.currentStatus] };
}

export function colorFor(change: StatusChange): number {
  return accentFor(change).color;
}

export function statusLabel(status: OverallStatus, locale: string): string {
  return t(locale, STATUS_KEY[status]);
}

export function severityLabel(status: OverallStatus, locale: string): string {
  return statusLabel(status, locale).toLocaleUpperCase(locale);
}

/** Translates a provider's own lifecycle word, leaving an unknown one visible. */
function incidentStatusLabel(providerStatus: string, locale: string): string {
  if (providerStatus === "") return providerStatus;
  const key = `incident.status.${providerStatus}`;
  const translated = t(locale, key);
  return translated === key ? providerStatus : translated;
}

export interface MessageParts {
  /** One line, emoji included: "🔴 GitHub — MAJOR OUTAGE". */
  heading: string;
  /** Everything below it, with no link — the channel renders that itself. */
  detail: string;
  /** The provider's status page, for a channel that links it as an affordance. */
  url: string;
  color: number;
}

/**
 * The same message, handed over in pieces, for a channel whose native format is
 * structured — a Discord embed title, a Slack section plus a link button. The
 * words still come from one catalog template per kind, so a rich channel can
 * never drift from a plain one; only the arrangement differs.
 *
 * Every template is written as "heading, blank line, detail", which is what the
 * split below relies on — `formatting.test.ts` holds every kind and locale to
 * that shape.
 */
export function renderParts(payload: NotificationPayload): MessageParts {
  const rendered = render(payload, { omitUrl: true });
  const separator = rendered.indexOf("\n\n");
  const heading = separator === -1 ? rendered : rendered.slice(0, separator);
  const detail = separator === -1 ? "" : rendered.slice(separator + 2).trim();
  return {
    heading,
    detail,
    url: payload.service.statusUrl,
    color: colorFor(payload.change),
  };
}

export function renderMessage(payload: NotificationPayload): string {
  return render(payload, { omitUrl: false });
}

function render(payload: NotificationPayload, options: { omitUrl: boolean }): string {
  const { change, service, locale } = payload;
  const updatedAt = formatUtc(change.incident?.updatedAt ?? change.at);

  // A resolution is headed by the word "resolved" rather than by the status it
  // recovered to, which is what an operator scanning a phone expects to see.
  const heading =
    change.kind === "incident_resolved"
      ? t(locale, "incident.status.resolved").toLocaleUpperCase(locale)
      : severityLabel(change.currentStatus, locale);

  const body = t(locale, TEMPLATE[change.kind], {
    provider: service.name,
    severity: heading,
    previous: change.previousStatus === undefined ? "" : statusLabel(change.previousStatus, locale),
    current: statusLabel(change.currentStatus, locale),
    title: change.incident?.name ?? change.maintenance?.name ?? "",
    status: incidentStatusLabel(change.incident?.status ?? "", locale),
    count: change.failureCount ?? change.openIncidents ?? 0,
    endsAt:
      change.maintenance?.endsAt === null || change.maintenance?.endsAt === undefined
        ? t(locale, "maintenance.no-end")
        : formatUtc(change.maintenance.endsAt),
    lastStatus: statusLabel(change.currentStatus, locale),
    component: change.component?.name ?? "",
    updatedAt,
    // Dropped rather than templated away: a channel that links the status page
    // itself would otherwise print it twice.
    url: options.omitUrl ? "" : service.statusUrl,
  });

  return `${accentFor(change).emoji} ${body}`.trimEnd();
}
