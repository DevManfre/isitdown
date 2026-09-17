import { activeWindows } from "./maintenance.ts";
import type {
  DampingState,
  NormalizedStatus,
  OverallStatus,
  StatusChange,
} from "./types.ts";

export interface DiffInputs {
  /**
   * ISO 8601, UTC. While the reading was taken before it, the provider is
   * muted. Null or absent means it is not.
   */
  mutedUntil?: string | null | undefined;
}

/** Whether a reading taken at `at` falls inside a mute running until `until`. */
export function isMuted(until: string | null | undefined, at: string): boolean {
  // mutation-equivalent: || — `Date.parse` answers NaN for both, and the NaN
  // guard below already returns false, so the two connectives are one function.
  if (until === null || until === undefined) return false;
  const ends = Date.parse(until);
  const taken = Date.parse(at);
  // An unparseable mute is no mute: a bad value must not silence a provider
  // forever, which is the one failure mode of this feature that loses alerts.
  // mutation-equivalent: || — a comparison against NaN is false whichever side
  // it is on, so falling through instead of returning reaches the same answer.
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
  // mutation-equivalent: <= — a threshold of exactly 1 is met by the first
  // sample below, so taking the damping path with it returns the same changes.
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

/** A provider going worse, remembered long enough to be compared with others. */
export interface WorseningReading {
  providerId: string;
  /** ISO 8601, UTC. When the reading that went bad was taken. */
  at: string;
  status: OverallStatus;
}

export interface CorrelationInputs {
  /** Every worsening seen recently, in any order; older ones are ignored here. */
  recent: WorseningReading[];
  /** How wide the window is. */
  windowMinutes: number;
  /** How many distinct providers have to be in it. 0 or 1 turns this off. */
  threshold: number;
  /** ISO 8601, UTC. The end of the window — the cycle that just finished. */
  at: string;
}

/**
 * Whether a cycle's worsenings are better explained by one shared upstream than
 * by each provider having its own bad day (roadmap 2.7).
 *
 * Three providers going bad inside ten minutes is what a Cloudflare or an AWS
 * day looks like from here, and three separate alerts is the least useful way
 * to be told about it. This produces one change instead, and the poller drops
 * the member alerts that fired in the same cycle.
 *
 * It lives in the diff engine, beside `diff` itself and just as pure, because
 * it decides that something is news — and a notification produced anywhere else
 * is how the two paths start disagreeing about what an operator was told.
 *
 * Deliberately narrow. A worsening is a *reading that got worse*, so a provider
 * that was already down and stays down is not evidence of anything new; and
 * `unknown` is excluded for the same reason the diff engine refuses to compare
 * it — a page we could not read is not a page that reported trouble.
 *
 * The change names the worst-hit provider so routing, the delivery log and the
 * dashboard have a real subject, and carries the whole set in `correlated`.
 */
export function correlatedOutage(inputs: CorrelationInputs): StatusChange | null {
  if (!Number.isInteger(inputs.threshold) || inputs.threshold < 2) return null;
  const end = Date.parse(inputs.at);
  if (Number.isNaN(end)) return null;
  const opens = end - inputs.windowMinutes * 60_000;

  // One entry per provider, the worst reading it reached inside the window: a
  // provider that degraded and then went down twice is one provider, not three.
  const worst = new Map<string, WorseningReading>();
  for (const reading of inputs.recent) {
    const taken = Date.parse(reading.at);
    if (Number.isNaN(taken) || taken < opens || taken > end) continue;
    if (reading.status === "unknown" || reading.status === "operational") continue;
    const seen = worst.get(reading.providerId);
    if (seen === undefined || rank(reading.status) > rank(seen.status)) {
      worst.set(reading.providerId, reading);
    }
  }
  if (worst.size < inputs.threshold) return null;

  const members = [...worst.values()].sort(
    (a, b) => rank(b.status) - rank(a.status) || Date.parse(a.at) - Date.parse(b.at),
  );
  const [lead] = members;
  if (lead === undefined) return null;

  return {
    kind: "correlated_outage",
    providerId: lead.providerId,
    currentStatus: lead.status,
    correlated: {
      providerIds: members.map((member) => member.providerId),
      windowMinutes: inputs.windowMinutes,
    },
    at: inputs.at,
  };
}

/** Severity order, for picking the worst member. `unknown` never gets here. */
function rank(status: OverallStatus): number {
  switch (status) {
    case "major_outage":
      return 3;
    case "partial_outage":
      return 2;
    case "degraded":
      return 1;
    default:
      return 0;
  }
}

/**
 * The worsenings in a cycle's changes, for the window `correlatedOutage` reads.
 *
 * A transition into something worse than it was, whatever kind carried it: a
 * provider's overall status, one of its components, or an incident opening on a
 * page that was calm. An incident *update* is not a worsening — the provider is
 * restating a situation the operator has already been alerted about.
 */
export function worseningsIn(changes: StatusChange[]): WorseningReading[] {
  const readings: WorseningReading[] = [];
  for (const change of changes) {
    if (change.kind === "correlated_outage" || change.kind === "monitoring_degraded") continue;
    // A page that is lying is not a page that reported trouble: counting it
    // here would let one probe's failure pull an unrelated provider into a
    // shared-failure window.
    if (change.kind === "silent_outage") continue;
    if (change.kind === "incident_updated" || change.kind === "incident_resolved") continue;
    if (change.kind === "maintenance_started" || change.kind === "maintenance_ended") continue;
    const current = change.currentStatus;
    if (current === "unknown" || current === "operational") continue;
    const previous = change.previousStatus;
    if (previous !== undefined && rank(current) <= rank(previous)) continue;
    readings.push({ providerId: change.providerId, at: change.at, status: current });
  }
  return readings;
}

export interface CrossCheckInputs {
  /** The probe's own reading, taken this cycle. */
  probe: {
    id: string;
    status: OverallStatus;
    /** What the probe said about why, when it said anything. */
    note?: string | undefined;
  };
  /**
   * What the provider's own page last reported. Null when we have never read
   * it — which is not evidence of dishonesty, only of not knowing.
   */
  page: { id: string; status: OverallStatus; openIncidents: number } | null;
  /** ISO 8601, UTC. */
  at: string;
}

/**
 * Whether a provider's status page is claiming everything is fine while our own
 * probe of the same service cannot reach it — the silent-outage cross-check
 * (roadmap 1.10).
 *
 * This is the one thing IsItDown reports that is not in anybody's status page:
 * it monitors the page's *honesty*. A provider that is down and says so is
 * already a `status_change`; a provider that is down and says nothing is the
 * case an operator finds out about from their own users, and a probe pointed at
 * the same service is the evidence that turns it into an alert.
 *
 * Deliberately narrow, because the failure mode is a false accusation. The
 * probe has to have taken a reading (`unknown` is not one) and that reading has
 * to be worse than operational; the page has to say operational *and* carry no
 * open incident, so a provider that is halfway through admitting it is never
 * called a liar. One vantage point is still one vantage point — the poller's
 * own "this looks like our network" check runs first, on the same cycle.
 */
export function silentOutage(inputs: CrossCheckInputs): StatusChange | null {
  const { probe, page } = inputs;
  if (page === null) return null;
  if (probe.status === "unknown" || probe.status === "operational") return null;
  if (page.status !== "operational" || page.openIncidents > 0) return null;

  return {
    kind: "silent_outage",
    providerId: page.id,
    previousStatus: page.status,
    currentStatus: probe.status,
    crossCheck: { probeId: probe.id, ...(probe.note === undefined ? {} : { note: probe.note }) },
    at: inputs.at,
  };
}

export interface SlaBurnInputs {
  providerId: string;
  /** `YYYY-MM`, UTC — the month being measured. */
  month: string;
  /** The provider's target, as a percentage: 99.9. */
  target: number;
  /** Measured uptime so far this month, as a percentage. */
  uptime: number;
  /** How long the whole month is, and how much of it has been measured. */
  monthMinutes: number;
  measuredMinutes: number;
  /** ISO 8601, UTC. */
  at: string;
}

/**
 * Whether a provider is spending its monthly error budget faster than the month
 * can afford — roadmap 4.13.
 *
 * The row asked for the alert that turns history from "what happened" into
 * "does this vendor meet what we were promised". The arithmetic is the whole
 * feature: a 99.9% target over a 30-day month allows 43 minutes of downtime,
 * and the useful moment to say something is not when the 43rd minute is spent
 * but when the *rate* says it will be. Four days in with nine minutes gone is
 * already a month that misses, and that is a sentence worth reading on the 4th
 * rather than on the 30th.
 *
 * So the projection is simply the measured rate carried to the end of the
 * month: uptime so far *is* the projected uptime, and the alert fires when that
 * is below the target. Nothing cleverer, deliberately — a weighted or
 * decaying estimate would be a forecast, and a forecast that is wrong about a
 * vendor's month is worse than no forecast at all.
 *
 * It lives in the diff engine, pure like `silentOutage` and `correlatedOutage`
 * beside it, because it decides that something is news. What it is *not* is
 * per-cycle state: the caller is responsible for saying this once a month per
 * provider, exactly as the poller is responsible for not re-reporting a
 * correlation every cycle.
 *
 * Two guards, both about not making a claim the data does not support:
 *
 * - A month nothing has measured yet produces nothing. Zero samples is not 0%
 *   uptime, a distinction the whole history service already turns on.
 * - A month measured for less than `MIN_MEASURED_FRACTION` of what has elapsed
 *   produces nothing either. One bad hour on the 1st is a 100%-of-a-tiny-sample
 *   projection that says the month is lost, and by the 3rd it is not.
 */
const MIN_MEASURED_MINUTES = 6 * 60;

export function slaBurn(inputs: SlaBurnInputs): StatusChange | null {
  const { target, uptime, monthMinutes, measuredMinutes } = inputs;
  if (!(target > 0) || target > 100) return null;
  if (measuredMinutes < MIN_MEASURED_MINUTES) return null;
  if (monthMinutes <= 0) return null;
  // The rate so far, carried to the end of the month. Rounded like every other
  // percentage that leaves this codebase, so the number in the message is the
  // number on the dashboard.
  const projectedUptime = Math.round(uptime * 100) / 100;
  if (projectedUptime >= target) return null;

  const budgetMinutes = (monthMinutes * (100 - target)) / 100;
  const spentMinutes = (measuredMinutes * (100 - uptime)) / 100;

  return {
    kind: "sla_burn",
    providerId: inputs.providerId,
    // Not a severity the provider is in — it may well be operational as this
    // fires. `degraded` is what the *month* is, and it is the floor a rule
    // written as "tell me about anything real" already clears.
    currentStatus: "degraded",
    sla: {
      month: inputs.month,
      target,
      uptime: projectedUptime,
      budgetMinutes,
      spentMinutes,
      projectedUptime,
    },
    at: inputs.at,
  };
}
