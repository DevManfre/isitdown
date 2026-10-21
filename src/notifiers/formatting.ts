import { formatUtc, t } from "../core/i18n/index.ts";
import type {
  NotificationPayload,
  OverallStatus,
  StatusChange,
  StatusChangeKind,
} from "../core/types.ts";
import { fillTemplate, type TemplateValues } from "./template.ts";

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
  maintenance_upcoming: "notification.maintenance.upcoming",
  monitoring_degraded: "notification.monitoring.degraded",
  correlated_outage: "notification.correlated.outage",
  correlated_resolved: "notification.correlated.resolved",
  periodic_report: "notification.report.weekly",
  silent_outage: "notification.silent.outage",
  sla_burn: "notification.sla.burn",
  slow_status_page: "notification.slow.page",
  channel_failing: "notification.channel.failing",
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
  // A slow page is a hint read off our own measurement, not a severity the
  // provider declared, so it wears the same neutral pair (roadmap 1.10).
  // A failing channel is about our own delivery (roadmap 3.4): neutral too.
  if (
    change.kind === "monitoring_degraded" ||
    change.kind === "slow_status_page" ||
    change.kind === "channel_failing" ||
    change.kind === "periodic_report"
  ) {
    return { emoji: EMOJI.unknown, color: COLOR.unknown };
  }
  if (
    change.kind === "maintenance_started" ||
    change.kind === "maintenance_ended" ||
    change.kind === "maintenance_upcoming"
  ) {
    return { emoji: MAINTENANCE_EMOJI, color: MAINTENANCE_COLOR };
  }
  return {
    emoji: emojiFor(change.currentStatus),
    color: COLOR[change.currentStatus],
  };
}

/**
 * Whether this message should carry Ack and Mute (roadmap 3.1).
 *
 * Trouble that is still going, on a channel that can take the press — and
 * nothing else. A recovery has nothing left to take in charge, a heads-up about
 * maintenance or a slow page is not something to mute a provider over, and a
 * digest is a batch whose buttons would have to say which of its members they
 * mean. Decided here, once, so every channel that draws buttons draws them on
 * the same messages.
 */
export function offersActions(payload: NotificationPayload): boolean {
  if (payload.interactive !== true || payload.digest !== undefined) return false;
  const { change } = payload;
  switch (change.kind) {
    case "status_change":
    case "component_status_change":
    case "incident_opened":
    case "incident_updated":
      return change.currentStatus !== "operational" && change.currentStatus !== "unknown";
    default:
      return false;
  }
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

/**
 * An answer time as a person would say it: "840 ms" below a second, "4.2 s"
 * above. Built here rather than in the catalog because the unit switches with
 * the value, and the catalog has no way to say that.
 */
function durationLabel(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * A span of minutes as a person would say it: "45 min" up to an hour and a half,
 * "3 h" past it. Built here for the same reason `durationLabel` is — the unit
 * switches with the value and the catalog cannot say that.
 */
function minutesLabel(minutes: number): string {
  return minutes < 90 ? `${Math.max(1, Math.round(minutes))} min` : `${Math.round(minutes / 60)} h`;
}

/** How long a declared window is expected to last, or the catalog's "not stated". */
function plannedDuration(change: StatusChange, locale: string): string {
  const window = change.maintenance;
  const starts = window === undefined ? Number.NaN : Date.parse(window.startsAt);
  const ends = window?.endsAt == null ? Number.NaN : Date.parse(window.endsAt);
  if (Number.isNaN(starts) || Number.isNaN(ends) || ends <= starts) return t(locale, "maintenance.no-end");
  return minutesLabel((ends - starts) / 60_000);
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

/**
 * The same pieces, for a channel that posts in public — Mastodon, Bluesky
 * (roadmap 3.9). Impact and owner are the operator's handover notes ("Owner:
 * Maria, +39 …") and are dropped; everything else is the message every other
 * channel sends. A template is left alone: what it prints is the operator's
 * explicit choice.
 */
export function publicParts(payload: NotificationPayload): MessageParts {
  const { impact: _impact, owner: _owner, ...service } = payload.service;
  return renderParts({ ...payload, service });
}

export function renderMessage(payload: NotificationPayload): string {
  return render(payload, { omitUrl: false });
}

/** How a channel counts its limit: UTF-16 characters, UTF-8 bytes, or what a reader sees as one character. */
export type LimitUnit = "chars" | "bytes" | "graphemes";

const ELLIPSIS = "…";

/**
 * A text cut to what the channel accepts, with an ellipsis saying it was cut
 * (roadmap 3.8). Every channel has a ceiling — Pushover's 1024 characters,
 * Telegram's 4096, a syslog datagram's bytes — and a digest of forty changes or
 * a long template crosses it; past it the API answers 400 and the alert is
 * lost, which is a worse message than a shortened one.
 *
 * The cut never splits a character: not a surrogate pair in `chars`, not a
 * multi-byte sequence in `bytes`, not an emoji with its modifiers in
 * `graphemes`. Text already inside the limit comes back untouched, so a message
 * that fits is byte for byte what it was before this existed.
 */
export function fitText(text: string, max: number, unit: LimitUnit = "chars"): string {
  const units = unitsOf(text, unit);
  if (measure(units, unit) <= max) return text;
  const room = max - measure(unitsOf(ELLIPSIS, unit), unit);
  let kept = "";
  let used = 0;
  for (const piece of units) {
    const size = measure([piece], unit);
    if (used + size > room) break;
    kept += piece;
    used += size;
  }
  return `${kept.trimEnd()}${ELLIPSIS}`;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The text in the pieces a cut may fall between. */
function unitsOf(text: string, unit: LimitUnit): string[] {
  if (unit === "graphemes") return Array.from(segmenter.segment(text), (part) => part.segment);
  // Code points: the smallest piece that is never half a character.
  return Array.from(text);
}

function measure(pieces: string[], unit: LimitUnit): number {
  let total = 0;
  for (const piece of pieces) {
    total += unit === "bytes" ? Buffer.byteLength(piece, "utf8") : unit === "chars" ? piece.length : 1;
  }
  return total;
}

/**
 * The digest (roadmap 3.12): every change collected in one window, as one
 * message. A heading that says how many and over how long, then one line per
 * change — the same words each change would have carried on its own, minus the
 * per-message ceremony that is exactly what makes a flood a flood.
 *
 * Rendered here rather than in the dispatcher for the same reason every other
 * message is: layout and emoji are formatting, and a channel that assembled its
 * own digest would drift from the others by a version or two.
 */
export function renderDigest(
  items: NotificationPayload[],
  windowMinutes: number,
): string {
  const [first] = items;
  if (first === undefined) return "";
  const locale = first.locale;
  const heading = t(locale, "notification.digest.heading", {
    count: items.length,
    minutes: windowMinutes,
  });
  const lines = items.map((item) => {
    const { emoji } = accentFor(item.change);
    return `${emoji} ${t(locale, "notification.digest.line", {
      provider: item.service.name,
      what: summarise(item),
    })}`;
  });
  return [heading, "", ...lines].join("\n");
}

/**
 * One change in one line, for a digest. The full template is a heading, a blank
 * line and a detail block — right for a message about one thing, and unreadable
 * twelve times over — so the line is assembled from the same catalog pieces
 * instead: what changed, in the words the status vocabulary already has.
 */
function summarise(payload: NotificationPayload): string {
  const { change, locale } = payload;
  const current = statusLabel(change.currentStatus, locale);
  switch (change.kind) {
    case "status_change":
      return t(locale, "notification.digest.status", {
        previous:
          change.previousStatus === undefined
            ? ""
            : statusLabel(change.previousStatus, locale),
        current,
      });
    case "component_status_change":
      return t(locale, "notification.digest.component", {
        component: change.component?.name ?? "",
        current,
      });
    case "incident_opened":
      return t(locale, "notification.digest.incident-opened", {
        title: change.incident?.name ?? "",
      });
    case "incident_updated":
      return t(locale, "notification.digest.incident-updated", {
        title: change.incident?.name ?? "",
        status: incidentStatusLabel(change.incident?.status ?? "", locale),
      });
    case "incident_resolved":
      return t(locale, "notification.digest.incident-resolved", {
        title: change.incident?.name ?? "",
      });
    case "maintenance_started":
      return t(locale, "notification.digest.maintenance-started", {
        title: change.maintenance?.name ?? "",
      });
    case "maintenance_ended":
      return t(locale, "notification.digest.maintenance-ended", {
        title: change.maintenance?.name ?? "",
      });
    case "maintenance_upcoming":
      return t(locale, "notification.digest.maintenance-upcoming", {
        title: change.maintenance?.name ?? "",
        startsIn: minutesLabel(change.startsInMinutes ?? 0),
      });
    case "monitoring_degraded":
      return t(locale, "notification.digest.monitoring", {
        count: change.failureCount ?? 0,
      });
    case "silent_outage":
      return t(locale, "notification.digest.silent", {
        probe: change.crossCheck?.probeId ?? "",
        // The SLA burn's own numbers (roadmap 4.13). Formatted to two decimals
        // here rather than in the catalog: a percentage printed as 99.87333333 is
        // the kind of detail that makes a message read like a debug dump.
        month: change.sla?.month ?? "",
        target: (change.sla?.target ?? 0).toFixed(2),
        uptime: (change.sla?.uptime ?? 0).toFixed(2),
        projected: (change.sla?.projectedUptime ?? 0).toFixed(2),
        budgetMinutes: Math.round(change.sla?.budgetMinutes ?? 0),
        spentMinutes: Math.round(change.sla?.spentMinutes ?? 0),
        current,
      });
    case "correlated_outage":
      return t(
        locale,
        change.correlated?.cause === undefined
          ? "notification.digest.correlated"
          : "notification.digest.correlated-cause",
        {
          count: change.correlated?.providerIds.length ?? 0,
          providers: (change.correlated?.providerIds ?? []).join(", "),
          cause: change.correlated?.cause ?? "",
        },
      );
    case "correlated_resolved":
      return t(locale, "notification.digest.correlated-resolved", {
        count: change.correlated?.providerIds.length ?? 0,
        lasted: minutesLabel(change.correlated?.durationMinutes ?? 0),
      });
    case "sla_burn":
      return t(locale, "notification.digest.sla", {
        target: (change.sla?.target ?? 0).toFixed(2),
        projected: (change.sla?.projectedUptime ?? 0).toFixed(2),
      });
    case "slow_status_page":
      return t(locale, "notification.digest.slow-page", {
        latency: durationLabel(change.latency?.latencyMs ?? 0),
        median: durationLabel(change.latency?.medianMs ?? 0),
      });
    case "channel_failing":
      return t(locale, "notification.digest.channel-failing", {
        channel: change.channel?.id ?? "",
        count: change.channel?.failures ?? 0,
      });
    case "periodic_report":
      return t(locale, "notification.digest.report", {
        uptime: change.report?.fleetUptime?.toFixed(2) ?? "—",
      });
  }
}

/**
 * The periodic report (roadmap 3.13) as the lines somebody reads: the fleet's
 * figure first, then who dragged it down, then the error budget. Built from
 * catalog pieces rather than one template because the middle sections come and
 * go — nothing measured, nothing below 100%, no provider with a target — and a
 * template cannot say "omit this paragraph".
 */
function reportText(change: StatusChange, locale: string): string {
  const report = change.report;
  if (report === undefined) return t(locale, "notification.report.unmeasured");
  const lines = [
    t(locale, report.frequency === "weekly" ? "notification.report.weekly" : "notification.report.monthly", {
      from: report.from,
      to: report.to,
    }),
    "",
  ];
  if (report.fleetUptime === null) {
    lines.push(t(locale, "notification.report.unmeasured"));
  } else {
    lines.push(
      t(locale, "notification.report.uptime", { uptime: report.fleetUptime.toFixed(2) }),
      t(locale, "notification.report.incidents", { count: report.incidentCount }),
      "",
    );
    if (report.worst.length === 0) {
      lines.push(t(locale, "notification.report.worst-none"));
    } else {
      lines.push(
        t(locale, "notification.report.worst-heading"),
        ...report.worst.map((entry) =>
          t(locale, "notification.report.worst-line", {
            provider: entry.providerId,
            uptime: entry.uptime.toFixed(2),
          }),
        ),
      );
    }
  }
  if (report.sla.length > 0) {
    lines.push(
      "",
      t(locale, "notification.report.budget-heading"),
      ...report.sla.map((entry) =>
        t(locale, "notification.report.budget-line", {
          provider: entry.providerId,
          spent: Math.round(entry.spentMinutes),
          budget: Math.round(entry.budgetMinutes),
          percent: entry.budgetMinutes <= 0 ? 100 : Math.round((entry.spentMinutes / entry.budgetMinutes) * 100),
        }),
      ),
    );
  }
  return lines.join("\n");
}

/**
 * The line a message carries when the cap swallowed others before it (roadmap
 * 3.13). Appended by the dispatcher rather than templated into every message
 * kind: it is not about the change, it is about what the operator did not get
 * told.
 */
export function suppressedLine(count: number, locale: string): string {
  return t(locale, "notification.suppressed", { count });
}

/**
 * What each template token stands for, for this one change — roadmap 3.15.
 *
 * Resolved here rather than in `template.ts` because every value below comes
 * from a catalog lookup or a helper this file already owns: a token map built
 * anywhere else would be a second vocabulary, free to drift from the default
 * message by a locale or a label. `template.ts` holds the token *names* and the
 * substitution; this holds their meaning.
 */
export function templateValues(
  payload: NotificationPayload,
  options: { omitUrl: boolean } = { omitUrl: false },
): TemplateValues {
  const { change, service, locale } = payload;
  return {
    // Rendered with the template dropped, deliberately: this token stands for
    // the default message, and resolving it through the template would recurse.
    message: render({ ...payload, template: undefined }, options),
    emoji: accentFor(change).emoji,
    provider: service.name,
    providerId: service.id,
    kind: change.kind,
    severity: severityLabel(change.currentStatus, locale),
    status: statusLabel(change.currentStatus, locale),
    previous:
      change.previousStatus === undefined
        ? ""
        : statusLabel(change.previousStatus, locale),
    component: change.component?.name ?? "",
    title: change.incident?.name ?? change.maintenance?.name ?? "",
    incidentStatus: incidentStatusLabel(change.incident?.status ?? "", locale),
    impact: service.impact ?? "",
    owner: service.owner ?? "",
    // Dropped for a channel that links the status page itself, on the same rule
    // the default rendering follows: a Discord embed already carries the link
    // as a button, and a template that printed it again would print it twice.
    url: options.omitUrl ? "" : service.statusUrl,
    at: formatUtc(change.incident?.updatedAt ?? change.at),
  };
}

function render(
  payload: NotificationPayload,
  options: { omitUrl: boolean },
): string {
  // A digest is its own message shape, so it short-circuits the per-kind
  // template below — but it still goes through here, which is what keeps the
  // suppressed line and every channel's own rendering path shared.
  if (payload.digest !== undefined) {
    return withSuppressed(
      renderDigest(payload.digest.items, payload.digest.windowMinutes),
      payload,
    );
  }

  // A report is its own document: no template describes it, and nothing about
  // a provider's status belongs under it (roadmap 3.13).
  if (payload.change.kind === "periodic_report") {
    return withSuppressed(reportText(payload.change, payload.locale), payload);
  }

  // The channel's own template, when it has one (roadmap 3.15). Checked after
  // the digest above and before the per-kind catalog below: a digest describes
  // a batch and a template describes one change, so the two never meet, and
  // everything past this point is the default rendering a template replaces.
  //
  // The suppressed line still goes on afterwards, like it does for every other
  // shape here: it is not about the change, so a template has no token for it
  // and no way to lose it.
  if (payload.template !== undefined && payload.template.trim() !== "") {
    return withSuppressed(
      fillTemplate(payload.template, templateValues(payload, options)),
      payload,
    );
  }

  const { change, service, locale } = payload;
  const updatedAt = formatUtc(change.incident?.updatedAt ?? change.at);

  // A resolution is headed by the word "resolved" rather than by the status it
  // recovered to, which is what an operator scanning a phone expects to see.
  const heading =
    change.kind === "incident_resolved"
      ? t(locale, "incident.status.resolved").toLocaleUpperCase(locale)
      : severityLabel(change.currentStatus, locale);

  // Roadmap 9.1. The disagreement is reported either way; what changes is what
  // the message says it means. With a `declared` page the news is that the page
  // has not caught up with its own service; with an `observed` one the page is
  // an opinion and our reading is the record, so the sentence has to stop
  // implying the page is the thing that was supposed to be right.
  const key =
    change.kind === "silent_outage" &&
    change.crossCheck?.authority === "observed"
      ? "notification.silent.outage-observed"
      : change.kind === "correlated_outage" &&
          change.correlated?.cause !== undefined
        ? "notification.correlated.outage-cause"
        : change.kind === "correlated_resolved" &&
            change.correlated?.cause !== undefined
          ? "notification.correlated.resolved-cause"
          : TEMPLATE[change.kind];

  const body = t(locale, key, {
    provider: service.name,
    severity: heading,
    previous:
      change.previousStatus === undefined
        ? ""
        : statusLabel(change.previousStatus, locale),
    current: statusLabel(change.currentStatus, locale),
    title: change.incident?.name ?? change.maintenance?.name ?? "",
    status: incidentStatusLabel(change.incident?.status ?? "", locale),
    count:
      change.failureCount ??
      change.openIncidents ??
      change.correlated?.providerIds.length ??
      change.channel?.failures ??
      0,
    // The channel that keeps failing (roadmap 3.4), since when, and what it said.
    channel: change.channel?.id ?? "",
    since: formatUtc(change.channel?.since ?? change.at),
    error: change.channel?.error ?? "",
    // Provider ids rather than names: only the change's own provider has a
    // name here, and a list that mixed one display name with N slugs would
    // read as two different things.
    providers: (change.correlated?.providerIds ?? []).join(", "),
    cause: change.correlated?.cause ?? "",
    minutes: change.correlated?.windowMinutes ?? 0,
    lasted: minutesLabel(change.correlated?.durationMinutes ?? 0),
    startsIn: minutesLabel(change.startsInMinutes ?? 0),
    startsAt: formatUtc(change.maintenance?.startsAt ?? change.at),
    duration: plannedDuration(change, locale),
    probe: change.crossCheck?.probeId ?? "",
    note: change.crossCheck?.note ?? "",
    latency: durationLabel(change.latency?.latencyMs ?? 0),
    median: durationLabel(change.latency?.medianMs ?? 0),
    threshold: durationLabel(change.latency?.thresholdMs ?? 0),
    endsAt:
      change.maintenance?.endsAt === null ||
      change.maintenance?.endsAt === undefined
        ? t(locale, "maintenance.no-end")
        : formatUtc(change.maintenance.endsAt),
    lastStatus: statusLabel(change.currentStatus, locale),
    component: change.component?.name ?? "",
    updatedAt,
    // Dropped rather than templated away: a channel that links the status page
    // itself would otherwise print it twice.
    url: options.omitUrl ? "" : service.statusUrl,
  });

  return withSuppressed(
    withContext(`${accentFor(change).emoji} ${body}`.trimEnd(), payload),
    payload,
  );
}

/**
 * Why this provider matters and who answers for it (roadmap 3.7), under the
 * message. Only on the default rendering: a template has `{{impact}}` and
 * `{{owner}}` tokens and decides for itself where they go, and a digest is about
 * several providers at once. Not on a failing channel either — that alert names
 * a provider only because the lost message happened to be about it.
 */
function withContext(message: string, payload: NotificationPayload): string {
  if (payload.change.kind === "channel_failing" || payload.change.kind === "periodic_report") return message;
  const { impact, owner } = payload.service;
  const lines = [
    ...(impact === undefined || impact === "" ? [] : [t(payload.locale, "notification.impact", { impact })]),
    ...(owner === undefined || owner === "" ? [] : [t(payload.locale, "notification.owner", { owner })]),
  ];
  return lines.length === 0 ? message : `${message}\n\n${lines.join("\n")}`;
}

/**
 * The cap's own line, appended to whatever the message already said. Appended
 * rather than templated in, so it reads the same on a digest and on a single
 * change, and so a message with nothing suppressed is byte-for-byte what it
 * was before the cap existed.
 */
function withSuppressed(message: string, payload: NotificationPayload): string {
  const count = payload.suppressedCount ?? 0;
  const withCount = count <= 0 ? message : `${message}\n\n${suppressedLine(count, payload.locale)}`;
  // The escalation's own line (roadmap 3.2), after the cap's: also not about the
  // change but about how it came to be said a second time, and appended for the
  // same reason — a template has no token for it, so it cannot be templated away.
  if (payload.escalated === undefined) return withCount;
  return `${withCount}\n\n${t(payload.locale, "notification.escalated", { minutes: payload.escalated.afterMinutes })}`;
}
