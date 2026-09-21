import { renderMessage, renderParts } from "../notifiers/formatting.ts";
import type {
  ChannelConfig,
  RuntimeConfig,
} from "../core/configSource.interface.ts";
import type {
  NotificationPayload,
  StatusChange,
  StatusChangeKind,
} from "../core/types.ts";

/**
 * What every configured channel would actually say, side by side — roadmap
 * 14.1.
 *
 * Settings can already send a test message and the routing rules can already
 * explain themselves, but nothing showed the *rendered text* for each channel
 * before it was real. Which matters because two channels handed the same change
 * inside one cycle can say different things: each carries its own locale
 * (roadmap 3.20) and its own template (3.15), and until now the only way to
 * find out what that produced was to cause an outage.
 *
 * Nothing is sent and nothing is recorded. The preview renders from the same
 * two pure functions every notifier builds its body with, so this cannot drift
 * from what a real send produces without the notifiers drifting too:
 *
 * - `renderMessage` is the whole text, which is byte for byte what a text
 *   channel posts.
 * - `renderParts` is the heading, the detail and the url — the three pieces
 *   every structured channel (a Slack block kit message, a Teams adaptive card,
 *   a PagerDuty event) assembles its own shape out of.
 *
 * What the preview deliberately does not do is rebuild those shapes. A mock-up
 * of a Slack block is a drawing of a message rather than the message, and one
 * that drifted would be worse than no preview at all: it would be believed. The
 * parts are the honest common denominator, and they are what an operator is
 * actually checking — the wording, the language, the template.
 */

/** The transports whose body *is* the rendered text, with nothing wrapped around it. */
const TEXT_CHANNELS = new Set([
  "telegram",
  "ntfy",
  "gotify",
  "pushover",
  "matrix",
  "apprise",
  "email",
]);

export interface ChannelPreview {
  channel: string;
  enabled: boolean;
  /** The language this channel writes in — its own, or the configured default. */
  locale: string;
  /** Whether this channel has a template of its own (roadmap 3.15). */
  templated: boolean;
  /**
   * The full message, for a channel that posts text. Null for one that builds a
   * structure of its own — see the module comment for why nothing is invented.
   */
  text: string | null;
  /** The pieces every channel is built from, whatever it wraps them in. */
  parts: { heading: string; detail: string; url: string };
}

export interface PreviewResult {
  kind: StatusChangeKind;
  /** The provider the fake transition names — the fleet's first, or a stand-in. */
  provider: string;
  channels: ChannelPreview[];
}

/** The transitions worth previewing: one per shape a message can take. */
export const PREVIEW_KINDS = [
  "status_change",
  "incident_opened",
  "incident_resolved",
  "maintenance_started",
  "monitoring_degraded",
  "silent_outage",
] as const satisfies readonly StatusChangeKind[];

export type PreviewKind = (typeof PREVIEW_KINDS)[number];

/**
 * One invented transition, shaped like the real thing.
 *
 * Fixed rather than drawn from the stored history: a preview has to render the
 * same way on an install whose fleet has never had an incident, and an
 * operator comparing two channels needs the two to differ only by channel.
 */
function fakeChange(
  kind: PreviewKind,
  providerId: string,
  at: string,
): StatusChange {
  const base = { providerId, at };
  switch (kind) {
    case "incident_opened":
      return {
        ...base,
        kind,
        currentStatus: "major_outage",
        incident: {
          id: "preview",
          name: "Elevated error rates",
          impact: "major",
          status: "investigating",
          updatedAt: at,
        },
      };
    case "incident_resolved":
      return {
        ...base,
        kind,
        previousStatus: "major_outage",
        currentStatus: "operational",
        incident: {
          id: "preview",
          name: "Elevated error rates",
          impact: "major",
          status: "resolved",
          updatedAt: at,
        },
      };
    case "maintenance_started":
      return {
        ...base,
        kind,
        currentStatus: "operational",
        maintenance: {
          id: "preview",
          name: "Scheduled database maintenance",
          status: "in_progress",
          startsAt: at,
          endsAt: null,
          componentIds: [],
        },
      };
    case "monitoring_degraded":
      return { ...base, kind, currentStatus: "unknown", failureCount: 5 };
    case "silent_outage":
      return {
        ...base,
        kind,
        previousStatus: "operational",
        currentStatus: "major_outage",
        crossCheck: {
          probeId: "preview-probe",
          note: "connection refused",
          authority: "declared",
        },
      };
    default:
      return {
        ...base,
        kind: "status_change",
        previousStatus: "operational",
        currentStatus: "major_outage",
      };
  }
}

export function previewChannels(
  config: RuntimeConfig,
  kind: PreviewKind,
  now: Date = new Date(),
): PreviewResult {
  // The first provider gives the preview a real name and a real status url, so
  // what is on screen is the message this installation would send. A fleet with
  // none still previews — an empty dashboard is exactly when an operator is
  // setting channels up.
  const provider = config.services[0];
  const service = {
    id: provider?.id ?? "example",
    name: provider?.name ?? "Example Provider",
    statusUrl: provider?.baseUrl ?? "https://status.example.com",
  };
  const at = now.toISOString();
  const change = fakeChange(kind, service.id, at);

  const channels = config.channels.map(
    (channel: ChannelConfig): ChannelPreview => {
      // Exactly what the dispatcher hands a notifier, built the same way: the
      // channel's own locale and template when it has them, the configured
      // defaults when it does not.
      const payload: NotificationPayload = {
        change,
        service,
        locale: channel.locale ?? config.locale,
        ...(channel.template === undefined
          ? {}
          : { template: channel.template }),
      };
      const parts = renderParts(payload);
      return {
        channel: channel.id,
        enabled: channel.enabled,
        locale: payload.locale,
        templated: channel.template !== undefined,
        text: TEXT_CHANNELS.has(channel.id) ? renderMessage(payload) : null,
        parts: { heading: parts.heading, detail: parts.detail, url: parts.url },
      };
    },
  );

  return { kind, provider: service.name, channels };
}
