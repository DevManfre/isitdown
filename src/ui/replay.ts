import { confirmedChanges, signatureOf } from "../core/diffEngine.ts";
import type { DeliveryConfig } from "../core/delivery.ts";
import { effectiveMutedUntil } from "../core/mute.ts";
import { clearsFloor, explain, inQuietHours, severityOf, type RoutingRule } from "../core/routing.ts";
import type { ServiceDefinition } from "../core/configSource.interface.ts";
import type { NormalizedStatus, StatusChange, StatusChangeKind } from "../core/types.ts";

/**
 * Why did I get this alert? — roadmap 5.12.
 *
 * `explain` in the routing says what *would* happen to a change; this says what
 * *did*: it takes the readings the poller saved, plays them back through the
 * same diff engine, flap damping, routing and quiet hours the live path uses, and
 * prints the decisions along the way. Pure like the engine it replays — the route
 * hands it rows and settings and nothing here reads a database.
 *
 * Two honest limits, both surfaced in the answer rather than hidden in it:
 * it replays with the settings in force *now* (the rules, the quiet hours, the
 * mute and `confirmSamples` of this minute, not of the alert's), and the cap is
 * described from the log because the dispatcher keeps its own count in memory.
 * When today's settings would not have produced the alert, `reproduced` is false
 * and the path stops at the diff: a replay that always found an explanation
 * would be worse than one that says it cannot.
 */

/**
 * The kinds `diff` itself emits. Everything else — a report, a channel failing,
 * a slow page, a correlated outage — is decided somewhere that is not a
 * comparison of two readings, so there is no pair of readings to play back.
 */
const DIFF_KINDS: readonly StatusChangeKind[] = [
  "status_change",
  "component_status_change",
  "incident_opened",
  "incident_updated",
  "incident_resolved",
  "maintenance_started",
  "maintenance_ended",
];

export interface ReplayInput {
  notification: { providerId: string; channel: string; kind: StatusChangeKind; sentAt: string };
  /** The provider's saved readings, in any order; the oldest played first. */
  readings: NormalizedStatus[];
  service: Pick<ServiceDefinition, "id" | "name" | "mutedUntil" | "muteSchedules" | "group" | "tags">;
  rules: RoutingRule[];
  enabledChannelIds: string[];
  delivery: DeliveryConfig;
  confirmSamples: number;
  /** Distinct alerts the log shows for this provider in the hour before `sentAt`. */
  alertsInPreviousHour: number;
}

export type ReplayStepName = "diff" | "damping" | "routing" | "channel" | "quiet-hours" | "cap";

export interface ReplayStep {
  step: ReplayStepName;
  outcome: string;
  /** Plain data the dashboard words; never a sentence, so it can be translated. */
  detail: Record<string, unknown>;
}

export interface ReplayResult {
  /** False for a kind no pair of readings produces (a report, a failing channel). */
  replayable: boolean;
  /** False when the saved readings no longer reach back to this alert. */
  available: boolean;
  /** Whether today's settings, played over the readings, produce this alert. */
  reproduced: boolean;
  previous: { fetchedAt: string; overallStatus: NormalizedStatus["overallStatus"] } | null;
  trigger: { fetchedAt: string; overallStatus: NormalizedStatus["overallStatus"] } | null;
  path: ReplayStep[];
}

const brief = (status: NormalizedStatus | null): ReplayResult["trigger"] =>
  status === null ? null : { fetchedAt: status.fetchedAt, overallStatus: status.overallStatus };

export function replayNotification(input: ReplayInput): ReplayResult {
  const { notification, service, delivery } = input;
  const nothing = (over: Partial<ReplayResult>): ReplayResult => ({
    replayable: true,
    available: true,
    reproduced: false,
    previous: null,
    trigger: null,
    path: [],
    ...over,
  });

  if (!DIFF_KINDS.includes(notification.kind)) return nothing({ replayable: false });

  const readings = [...input.readings].sort((a, b) => Date.parse(a.fetchedAt) - Date.parse(b.fetchedAt));
  // Nothing saved, or everything saved is newer than the alert: the readings that
  // caused it have been trimmed away. That is "I cannot tell", which is not the
  // same answer as "today's settings would not have sent it".
  if (readings.length === 0 || Date.parse(readings[0]!.fetchedAt) > Date.parse(notification.sentAt)) {
    return nothing({ available: false });
  }

  // Play the saved readings back the way the poller took them: each one against
  // the baseline the operator was last told about, through the same gate flap
  // damping and the mute are expressed through. The latest step at or before the
  // moment the alert was sent that produced this kind of change is the culprit.
  const sentAt = Date.parse(notification.sentAt);
  let baseline: NormalizedStatus | null = null;
  let last: NormalizedStatus | null = null;
  let pending: { signature: string; count: number } | null = null;
  let held: string[] = [];

  let found: { change: StatusChange; previous: NormalizedStatus | null; trigger: NormalizedStatus; held: string[] } | null = null;

  for (const next of readings) {
    if (Date.parse(next.fetchedAt) > sentAt) break;
    const before = baseline ?? last;
    const gate = confirmedChanges(next, {
      baseline,
      last,
      pending,
      confirmations: input.confirmSamples,
      mutedUntil: effectiveMutedUntil(service, next.fetchedAt),
    });

    const match = gate.changes.find((change) => change.kind === notification.kind);
    if (match !== undefined) found = { change: match, previous: before, trigger: next, held };

    // What the sequence of held samples looks like: a sample that moved `pending`
    // forward without confirming is one the operator was not told about yet.
    held =
      gate.pending === null
        ? []
        : pending !== null && pending.signature === signatureOf(next)
          ? [...held, next.fetchedAt]
          : [next.fetchedAt];

    baseline = gate.baseline;
    pending = gate.pending;
    last = next;
  }

  if (found === null) {
    return nothing({
      path: [{ step: "diff", outcome: "no-change", detail: { readings: readings.length } }],
    });
  }

  const { change, trigger } = found;
  const path: ReplayStep[] = [
    {
      step: "diff",
      outcome: "change",
      detail: {
        kind: change.kind,
        from: found.previous?.overallStatus ?? null,
        to: trigger.overallStatus,
        severity: severityOf(change),
      },
    },
    {
      step: "damping",
      outcome: input.confirmSamples > 1 ? "confirmed" : "off",
      detail: { required: input.confirmSamples, held: found.held },
    },
  ];

  const routed = explain(change, input.rules, input.enabledChannelIds, {
    quietHours: delivery.quietHours,
    at: new Date(notification.sentAt),
    ...(service.group === undefined ? {} : { providerGroup: service.group }),
    ...(service.tags === undefined ? {} : { providerTags: service.tags }),
  });
  const winning = routed.winner === null ? null : input.rules[routed.winner]!;

  path.push({
    step: "routing",
    outcome: routed.winner === null ? "no-rule" : "rule",
    detail: {
      winner: routed.winner,
      outcomes: routed.outcomes,
      rule: winning === null ? null : { provider: winning.provider, minSeverity: winning.minSeverity, channels: winning.channels },
      severity: severityOf(change),
    },
  });

  // `explain` empties the targets when quiet hours took them, so whether the
  // channel was *routed* is read off the winning rule, and the window is its own
  // step: the rule that won and the hour that overrode it are two answers.
  const routedChannels = new Set<string>();
  for (const id of winning?.channels ?? []) {
    for (const channel of id === "*" ? input.enabledChannelIds : [id]) routedChannels.add(channel);
  }
  path.push({
    step: "channel",
    outcome: routedChannels.has(notification.channel) ? "included" : "not-included",
    detail: { channel: notification.channel, routed: [...routedChannels] },
  });

  const quiet = delivery.quietHours;
  path.push({
    step: "quiet-hours",
    outcome: !quiet.enabled
      ? "off"
      : routed.quieted
        ? "suppressed"
        : inQuietHours(quiet, new Date(notification.sentAt)) && clearsFloor(severityOf(change), quiet.minSeverity)
          ? "passed-floor"
          : "outside",
    detail: { start: quiet.start, end: quiet.end, timeZone: quiet.timeZone, minSeverity: quiet.minSeverity },
  });

  path.push({
    step: "cap",
    outcome: !delivery.cap.enabled ? "off" : input.alertsInPreviousHour >= delivery.cap.maxPerHour ? "at-limit" : "under",
    detail: { maxPerHour: delivery.cap.maxPerHour, alertsInPreviousHour: input.alertsInPreviousHour },
  });

  return { replayable: true, available: true, reproduced: true, previous: brief(found.previous), trigger: brief(trigger), path };
}
