import { formatUtc, t } from "../core/i18n/index.ts";
import type { NotificationPayload, OverallStatus, StatusChangeKind } from "../core/types.ts";

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

const STATUS_KEY: Record<OverallStatus, string> = {
  operational: "status.operational",
  degraded: "status.degraded",
  partial_outage: "status.partial-outage",
  major_outage: "status.major-outage",
  unknown: "status.unknown",
};

const TEMPLATE: Record<StatusChangeKind, string> = {
  status_change: "notification.status.changed",
  incident_opened: "notification.incident.opened",
  incident_updated: "notification.incident.updated",
  incident_resolved: "notification.incident.resolved",
  monitoring_degraded: "notification.monitoring.degraded",
};

export function emojiFor(status: OverallStatus): string {
  return EMOJI[status];
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

export function renderMessage(payload: NotificationPayload): string {
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
    title: change.incident?.name ?? "",
    status: incidentStatusLabel(change.incident?.status ?? "", locale),
    count: change.failureCount ?? 0,
    lastStatus: statusLabel(change.currentStatus, locale),
    updatedAt,
    url: service.statusUrl,
  });

  // A monitoring warning is about our own fetching, not the provider's state, so
  // it never borrows the provider's colour.
  const emoji = change.kind === "monitoring_degraded" ? EMOJI.unknown : emojiFor(change.currentStatus);
  return `${emoji} ${body}`;
}
