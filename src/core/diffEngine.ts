import { activeWindows } from "./maintenance.ts";
import type { DampingState, NormalizedStatus, StatusChange } from "./types.ts";

export interface DiffInputs {
  /**
   * ISO 8601, UTC. While the reading was taken before it, the provider is
   * muted. Null or absent means it is not.
   */
  mutedUntil?: string | null | undefined;
}

/** Whether a reading taken at `at` falls inside a mute running until `until`. */
export function isMuted(until: string | null | undefined, at: string): boolean {
  if (until === null || until === undefined) return false;
  const ends = Date.parse(until);
  const taken = Date.parse(at);
  // An unparseable mute is no mute: a bad value must not silence a provider
  // forever, which is the one failure mode of this feature that loses alerts.
  if (Number.isNaN(ends) || Number.isNaN(taken)) return false;
  return taken < ends;
}

/**
 * The single authority on whether a notification fires. Pure and synchronous:
 * no I/O, no logging, no locale awareness — it emits structured changes and the
 * notifier decides how to word them.
 *
 * Three rules carry most of the value:
 *  - a null `previous` is a baseline, never news, so a fresh container or a new
 *    provider cannot produce a burst of alerts;
 *  - `unknown` on either side is not a comparable status, so a failed or
 *    unrecognised poll can never be reported as a transition — in particular
 *    never as a false recovery;
 *  - a declared maintenance window running at `next.fetchedAt` swallows every
 *    other change for that poll — the operator already knows, so nothing else
 *    about the provider is news until the window ends;
 *  - a mute the operator set, for the same reason: "I know, stop telling me"
 *    is the same statement a maintenance window makes, and it is answered in
 *    the same place rather than by filtering sends downstream.
 */
export function diff(
  previous: NormalizedStatus | null,
  next: NormalizedStatus,
  inputs: DiffInputs = {},
): StatusChange[] {
  if (previous === null) return [];
  // A mute is an operator-declared maintenance window in everything but name,
  // so it reads as one here: while it runs, nothing about this provider is
  // news. It is deliberately an input to the engine rather than a filter in the
  // dispatcher — the mute then shows up on the dashboard as a state, instead of
  // being a silence with nothing to explain it.
  if (isMuted(inputs.mutedUntil, next.fetchedAt)) return [];

  const base = { providerId: next.provider, at: next.fetchedAt };

  const runningBefore = new Map(activeWindows(previous).map((window) => [window.id, window]));
  const runningNow = new Map(activeWindows(next).map((window) => [window.id, window]));

  const maintenanceChanges: StatusChange[] = [];
  for (const [id, window] of runningNow) {
    if (runningBefore.has(id)) continue;
    maintenanceChanges.push({
      ...base,
      kind: "maintenance_started",
      currentStatus: next.overallStatus,
      maintenance: window,
    });
  }
  for (const [id, window] of runningBefore) {
    if (runningNow.has(id)) continue;
    maintenanceChanges.push({
      ...base,
      kind: "maintenance_ended",
      currentStatus: next.overallStatus,
      maintenance: window,
      openIncidents: next.activeIncidents.length,
    });
  }

  // A declared window is the operator's answer to "is this expected?" — while one
  // runs, nothing else about this provider is news. The reconciliation is
  // `maintenance_ended`, which carries the state the provider came out in, so a
  // real outage that began inside the window is announced rather than lost.
  if (runningNow.size > 0) return maintenanceChanges;

  const changes: StatusChange[] = [...maintenanceChanges];

  const comparable = previous.overallStatus !== "unknown" && next.overallStatus !== "unknown";
  if (comparable && previous.overallStatus !== next.overallStatus) {
    changes.push({
      ...base,
      kind: "status_change",
      previousStatus: previous.overallStatus,
      currentStatus: next.overallStatus,
    });
  }

  // Components follow the same two rules: a side the component is missing from
  // is a baseline (newly selected) or a removal (deselected or dropped by the
  // provider), never news; `unknown` is not comparable.
  const previousComponents = new Map(previous.components.map((component) => [component.id, component]));
  for (const component of next.components) {
    const seen = previousComponents.get(component.id);
    if (seen === undefined) continue;
    if (seen.status === "unknown" || component.status === "unknown") continue;
    if (seen.status !== component.status) {
      changes.push({
        ...base,
        kind: "component_status_change",
        previousStatus: seen.status,
        currentStatus: component.status,
        component: { id: component.id, name: component.name },
      });
    }
  }

  const before = new Map(previous.activeIncidents.map((incident) => [incident.id, incident]));
  const after = new Map(next.activeIncidents.map((incident) => [incident.id, incident]));

  for (const incident of next.activeIncidents) {
    const seen = before.get(incident.id);
    if (seen === undefined) {
      changes.push({ ...base, kind: "incident_opened", currentStatus: next.overallStatus, incident });
      continue;
    }
    // A provider bumping `updatedAt` or rewording the title is not an event.
    if (seen.status !== incident.status || seen.impact !== incident.impact) {
      changes.push({ ...base, kind: "incident_updated", currentStatus: next.overallStatus, incident });
    }
  }

  for (const incident of previous.activeIncidents) {
    if (!after.has(incident.id)) {
      changes.push({
        ...base,
        kind: "incident_resolved",
        previousStatus: previous.overallStatus,
        currentStatus: next.overallStatus,
        incident,
      });
    }
  }

  return changes;
}

/**
 * A reading condensed to what the engine above would notify about: the overall
 * status, every active incident's identity and lifecycle, every selected
 * component's status, and which maintenance windows are running.
 *
 * Two readings with the same signature produce the same changes against the
 * same baseline, which is what lets "the same thing, N times in a row" be
 * decided without keeping N whole readings around. Timestamps are deliberately
 * out of it: a provider re-stating the same incident a minute later is the same
 * news, not a new sample of a different one.
 */
export function signatureOf(status: NormalizedStatus): string {
  const incidents = status.activeIncidents
    .map((incident) => `${incident.id}:${incident.status}:${incident.impact}`)
    .sort();
  const components = status.components.map((component) => `${component.id}:${component.status}`).sort();
  const running = activeWindows(status)
    .map((window) => window.id)
    .sort();
  return JSON.stringify([status.overallStatus, incidents, components, running]);
}

export type { DampingState };

export interface ConfirmInputs extends DiffInputs {
  /**
   * The reading the operator was last told about. Null on a store written
   * before damping existed, in which case the last sample stands in — that is
   * exactly the undamped behaviour, so an upgrade cannot replay old news.
   */
  baseline: NormalizedStatus | null;
  /** The most recent sample, whether it was notified about or not. */
  last: NormalizedStatus | null;
  pending: DampingState | null;
  /**
   * How many consecutive samples must agree before a transition notifies.
   * 1 — the default — is damping off and behaves exactly like calling `diff`.
   */
  confirmations: number;
}

export interface ConfirmResult {
  /** What to notify about now. Empty while a transition is still unconfirmed. */
  changes: StatusChange[];
  /** The baseline to persist: the reading the next poll compares against. */
  baseline: NormalizedStatus | null;
  /** The pending candidate to persist, or null when nothing is being held. */
  pending: DampingState | null;
}

/**
 * The gate flap damping is expressed through, and the only thing the poller
 * calls: the table above still decides *what* is a change, this decides whether
 * we believe it yet.
 *
 * The rule is one sentence: a transition notifies once the same reading has come
 * back `confirmations` polls in a row. A provider whose page disagrees with
 * itself for one cycle — a cache serving a stale summary, a deploy halfway
 * through — therefore pages nobody, while a real outage costs at most
 * `confirmations - 1` extra polls of delay.
 *
 * The baseline moves separately from the samples on purpose. Samples keep being
 * recorded every poll, so the dashboard tells the truth about what the page says
 * right now; the baseline is what the *operator* was last told, and holding it
 * still is what makes a suppressed flap catch up rather than vanish — if the
 * provider stays changed, the same changes are emitted a poll or two later
 * against the same baseline.
 */
export function confirmedChanges(next: NormalizedStatus, inputs: ConfirmInputs): ConfirmResult {
  const against = inputs.baseline ?? inputs.last;
  const changes = diff(against, next, inputs);

  // Nothing to hold: either this is news the operator has already been given,
  // or a mute or a maintenance window swallowed it. Either way the baseline
  // catches up, so ending a mute does not replay what happened inside it.
  if (changes.length === 0) return { changes, baseline: next, pending: null };

  // Fail open on anything that is not a real threshold: damping trades latency
  // for trust, and a missing or nonsensical setting must lose the trade rather
  // than swallow alerts silently.
  if (!Number.isInteger(inputs.confirmations) || inputs.confirmations <= 1) {
    return { changes, baseline: next, pending: null };
  }

  const signature = signatureOf(next);
  const count = inputs.pending?.signature === signature ? inputs.pending.count + 1 : 1;
  if (count >= inputs.confirmations) return { changes, baseline: next, pending: null };

  // Held: the baseline stays where it is, so the next poll asks the same
  // question again rather than treating this reading as the new normal.
  return { changes: [], baseline: inputs.baseline, pending: { signature, count } };
}
