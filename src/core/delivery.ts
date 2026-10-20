import type { QuietHours, SeverityFloor } from "./routing.ts";
import { QUIET_HOURS_OFF } from "./routing.ts";

/**
 * How much of what the diff engine decided to say actually goes out tonight,
 * and in how many messages. Four controls, all of them the dispatcher's
 * business rather than the engine's: the engine answers "is this news?", these
 * answer "does the operator want to be woken up by it, and how often".
 *
 * They compose in one order, which the dispatcher applies and nothing else may
 * reorder: quiet hours (does this reach anybody at this hour), the cap (has
 * this provider already said enough this hour), then the digest (now, or with
 * the next batch).
 */

/** Roadmap 3.12: batch everything under a floor into one message per window. */
export interface DigestConfig {
  enabled: boolean;
  /**
   * How long changes are collected for before the batch goes out. The whole
   * design is in this number: too short and it is the flood it replaces, too
   * long and the first alert of an outage arrives late — which is what
   * `immediateFloor` exists to bound.
   */
  windowMinutes: number;
  /** A change this bad is sent the moment it happens, never batched. */
  immediateFloor: SeverityFloor;
}

/** Roadmap 3.13: a ceiling per provider, so one pathological page cannot flood. */
export interface AlertCapConfig {
  enabled: boolean;
  /**
   * Messages per rolling hour, per provider. Counted per provider rather than
   * per channel: the operator reading them is one person however many channels
   * they arrive on.
   */
  maxPerHour: number;
}

/**
 * Roadmap 3.3: a heads-up before a declared maintenance window opens, which is
 * the one alert that lets somebody act *before* rather than after.
 */
export interface MaintenanceNoticeConfig {
  enabled: boolean;
  /** How far ahead of its start a window is announced. */
  leadMinutes: number;
}

/**
 * Roadmap 3.2: a change nobody has taken in charge is said again, on a louder
 * channel. Reads the acknowledgement from 3.1, so it can only exist where there
 * is one to read — the UI edition.
 */
export interface EscalationConfig {
  enabled: boolean;
  /** How long a change may go unanswered before it is said again. */
  afterMinutes: number;
  /**
   * The channel it is said on — and only that one, the point being a *different*
   * way of reaching somebody. Empty means none chosen, which is not an
   * escalation: an operator who switched it on without picking a target is told
   * so in the log rather than sent a guess.
   */
  channel: string;
  /** The floor a change must clear to start the clock; a degraded blip does not page anybody twice. */
  minSeverity: SeverityFloor;
}

/**
 * Roadmap 3.4: a channel that refuses this many messages in a row is reported
 * on the others. A broken webhook otherwise shows up only as a badge in the
 * delivery log, and the operator has to notice an absence.
 */
export interface ChannelHealthConfig {
  enabled: boolean;
  afterFailures: number;
}

export interface DeliveryConfig {
  quietHours: QuietHours;
  digest: DigestConfig;
  cap: AlertCapConfig;
  /**
   * Roadmap 3.19: one incident becomes one message that is edited as the
   * incident moves, on the channels that can edit. Off by default — an
   * installation that has been reading one message per update would otherwise
   * find its history silently collapsing into a single line.
   */
  updateInPlace: boolean;
  maintenanceNotice: MaintenanceNoticeConfig;
  escalation: EscalationConfig;
  channelHealth: ChannelHealthConfig;
}

/**
 * Everything off. What an installation that has configured none of this
 * behaves like, which is exactly what it did before these controls existed.
 */
/**
 * The cap's rolling hour and a digest window that is still collecting live in
 * the dispatcher's memory, not in a store. A restart therefore clears both: the
 * first alerts after one are never swallowed by a cap nobody can see, and a
 * half-collected batch is lost rather than arriving an hour late. Both are the
 * side of that trade an operator watching a container come back up expects.
 */
export const DELIVERY_DEFAULTS: DeliveryConfig = {
  quietHours: QUIET_HOURS_OFF,
  digest: { enabled: false, windowMinutes: 15, immediateFloor: "major_outage" },
  cap: { enabled: false, maxPerHour: 10 },
  updateInPlace: false,
  maintenanceNotice: { enabled: false, leadMinutes: 120 },
  escalation: { enabled: false, afterMinutes: 15, channel: "", minSeverity: "major_outage" },
  channelHealth: { enabled: false, afterFailures: 3 },
};
