import type { OverallStatus } from "./types.ts";

/**
 * Passive monitors — the dead-man's switch, roadmap 2.5.
 *
 * Every other provider is something IsItDown goes and asks. This one is asked
 * *of* IsItDown: a cron job calls a URL when it finishes, and the alert is the
 * call that did not come — the backup that quietly stopped running three weeks
 * ago. The contract of the poller is inverted, but the path out is not: the
 * verdict below is read by an ordinary adapter on an ordinary cadence, so a
 * missed ping reaches the operator through the diff engine and the routing
 * like any outage, and a ping that arrives late resolves it the same way.
 *
 * Pure: options and timestamps in, a verdict out. Where the timestamps are
 * kept is the edition's business — only the UI edition has a URL a job can
 * call, so only it stores them (`src/ui/heartbeats.ts`).
 */

export const HEARTBEAT_ADAPTER_ID = "heartbeat";

/**
 * The `baseUrl` a heartbeat carries. A passive monitor reads no URL, but every
 * provider row has one; `.invalid` is the top-level domain reserved never to
 * resolve (RFC 2606), so nothing that does reach for it — a favicon lookup, a
 * link — can land on somebody else's host.
 */
export const HEARTBEAT_BASE_URL = "https://heartbeat.invalid";

/** A job that runs more than once a minute is a probe's work, not a heartbeat's. */
const MIN_EVERY_SECONDS = 60;
/** A monthly job, with a long month and a margin, still fits. */
const MAX_EVERY_SECONDS = 35 * 86_400;
const MIN_GRACE_SECONDS = 60;

export interface HeartbeatConfig {
  /** How often the job is expected to call, ping to ping. */
  everySeconds: number;
  /** How late a ping may be before it is missed. */
  graceSeconds: number;
}

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };

/** `90s`, `30m`, `24h`, `7d` — one number, one unit, nothing bare. */
export function parseDurationSeconds(input: string): number | null {
  const match = /^(\d+)\s*([smhd])$/i.exec(input.trim());
  if (match?.[1] === undefined || match[2] === undefined) return null;
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  return amount * UNIT_SECONDS[match[2].toLowerCase()]!;
}

/**
 * `every` and an optional `grace`, or a thrown error naming what is wrong.
 *
 * A bare number is refused rather than read as some unit: `every: 24` meaning
 * minutes to one operator and hours to the next is a monitor that alerts on
 * the wrong day. Grace defaults to a tenth of the period and never less than a
 * minute — a daily job a few minutes late is normal, an hourly one forty
 * minutes late is not.
 */
export function heartbeatConfig(options: Record<string, string> | undefined): HeartbeatConfig {
  const every = options?.["every"]?.trim();
  if (every === undefined || every === "") {
    throw new Error("a heartbeat needs every: how often the job calls, e.g. 24h");
  }
  const everySeconds = parseDurationSeconds(every);
  if (everySeconds === null) throw new Error(`every "${every}" is not a duration like 30m, 24h or 7d`);
  if (everySeconds < MIN_EVERY_SECONDS) throw new Error("every must be at least 1m");
  if (everySeconds > MAX_EVERY_SECONDS) throw new Error("every must be at most 35d");

  const grace = options?.["grace"]?.trim();
  if (grace === undefined || grace === "") {
    return { everySeconds, graceSeconds: Math.max(MIN_GRACE_SECONDS, Math.round(everySeconds / 10)) };
  }
  const graceSeconds = parseDurationSeconds(grace);
  if (graceSeconds === null) throw new Error(`grace "${grace}" is not a duration like 5m or 1h`);
  if (graceSeconds > everySeconds) throw new Error("grace cannot be longer than every");
  return { everySeconds, graceSeconds };
}

/** Why a heartbeat's options cannot work, one sentence each — the adapter's `validateOptions`. */
export function heartbeatProblems(options: Record<string, string> | undefined): string[] {
  try {
    heartbeatConfig(options);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

export interface HeartbeatTimes {
  /** ISO 8601. When the monitor started waiting — a job that never calls is still late. */
  armedAt: string;
  /** ISO 8601, or null before the first ping. */
  lastPingAt: string | null;
}

export interface HeartbeatVerdict {
  status: Extract<OverallStatus, "operational" | "major_outage">;
  /** ISO 8601. The moment the next ping is missed, or was. */
  deadline: string;
}

/**
 * Operational until the period and its grace have run out since the last ping
 * — or, before any ping, since the monitor was armed — and a missed ping from
 * then on. Never `unknown`: a job that has not called by its deadline is the
 * whole thing this exists to say, first run or not.
 */
export function heartbeatVerdict(config: HeartbeatConfig, times: HeartbeatTimes, now: Date): HeartbeatVerdict {
  const from = Date.parse(times.lastPingAt ?? times.armedAt);
  const deadline = from + (config.everySeconds + config.graceSeconds) * 1000;
  return {
    status: now.getTime() > deadline ? "major_outage" : "operational",
    deadline: new Date(deadline).toISOString(),
  };
}
