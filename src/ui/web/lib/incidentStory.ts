import type {
  IncidentNote, IncidentRevision, IncidentRow, OverallStatus, SampleRow, SentRecord, TimelineEntry,
} from "./types.ts";

/**
 * The incident detail page's story, worked out from the rows the API already
 * sends: how the sends group, what the incident looks like over time, and the
 * one sentence that says whether it is over. Pure, so the page only decides how
 * it reads.
 */

const MINUTE_MS = 60_000;

/** Sends closer together than this are one event: one status change fans out to every channel. */
const BURST_GAP_MS = 10 * MINUTE_MS;

/** Polls in a row that must read operational before an open incident is called recovered. */
const RECOVERED_AFTER_POLLS = 3;

export interface SendBurst {
  /** The newest send in the burst: where it sits on the timeline. */
  at: string;
  /** Oldest first, so the channels read in the order they were tried. */
  records: SentRecord[];
  delivered: number;
  failed: number;
}

/** `log` arrives newest first, as the API sends it; the bursts do too. */
export function groupSends(log: readonly SentRecord[]): SendBurst[] {
  const ordered = [...log].sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
  const groups: SentRecord[][] = [];
  for (const record of ordered) {
    const current = groups.at(-1);
    const previous = current?.at(-1);
    if (current !== undefined && previous !== undefined && Date.parse(previous.sentAt) - Date.parse(record.sentAt) <= BURST_GAP_MS) {
      current.push(record);
    } else {
      groups.push([record]);
    }
  }
  return groups.map((records) => {
    const oldestFirst = [...records].reverse();
    const failed = oldestFirst.filter((record) => !record.ok).length;
    return {
      at: records[0]?.sentAt ?? "",
      records: oldestFirst,
      delivered: oldestFirst.length - failed,
      failed,
    };
  });
}

export type Verdict =
  | { kind: "resolved"; minutes: number; sent: number; failed: number }
  | { kind: "recovered"; operationalPolls: number; sent: number; failed: number }
  | { kind: "active"; sent: number; failed: number };

/**
 * Whether the incident is over, and whether it still matters. `recovered` is the
 * case the page used to leave unexplained: the provider has not closed the
 * incident, but our own polls have been fine for a while — said as such, because
 * "Investigating" beside a row of green bars reads as a bug.
 */
export function verdictOf(input: {
  incident: IncidentRow;
  polls: readonly SampleRow[];
  actionLog: readonly SentRecord[];
  nowMs: number;
}): Verdict {
  const { incident, polls, actionLog } = input;
  const failed = actionLog.filter((record) => !record.ok).length;
  const sent = actionLog.length;

  if (incident.resolvedAt !== null) {
    const minutes = Math.max(0, Math.round((Date.parse(incident.resolvedAt) - Date.parse(incident.startedAt)) / MINUTE_MS));
    return { kind: "resolved", minutes, sent, failed };
  }

  // Newest first: count the unbroken run of operational readings from the top.
  let operationalPolls = 0;
  for (const poll of polls) {
    if (poll.overallStatus !== "operational") break;
    operationalPolls += 1;
  }
  if (operationalPolls >= RECOVERED_AFTER_POLLS) return { kind: "recovered", operationalPolls, sent, failed };
  return { kind: "active", sent, failed };
}

export type Reading = "ok" | "degraded" | "down" | "none";

export type MarkerKind = "opened" | "alert" | "failed" | "note" | "resolved" | "now";

export interface Lifeline {
  fromIso: string;
  toIso: string;
  open: boolean;
  /** One entry per equal slice of the incident's length, oldest first. */
  segments: Reading[];
  markers: { pct: number; kind: MarkerKind }[];
}

const READING: Partial<Record<OverallStatus, Reading>> = {
  operational: "ok",
  degraded: "degraded",
  partial_outage: "down",
  major_outage: "down",
};
const WORST: Record<Reading, number> = { none: 0, ok: 1, degraded: 2, down: 3 };

/**
 * The incident drawn as a shape over time: each slice shows the worst thing our
 * own polls read in it, and the sends and notes sit along it as markers.
 *
 * A slice no poll was kept for is `none`, not `ok`: the API keeps a bounded
 * number of polls, so the start of a long incident can be older than anything
 * we still hold, and painting that stretch green would be a claim nobody made.
 */
export function lifeline(input: {
  incident: IncidentRow;
  polls: readonly SampleRow[];
  actionLog: readonly SentRecord[];
  notes: readonly IncidentNote[];
  nowMs: number;
  buckets?: number;
}): Lifeline {
  const { incident, polls, actionLog, notes, nowMs } = input;
  const buckets = input.buckets ?? 48;
  const open = incident.resolvedAt === null;
  const startMs = Date.parse(incident.startedAt);
  const endMs = Math.max(open ? nowMs : Date.parse(incident.resolvedAt ?? ""), startMs + MINUTE_MS);
  const span = endMs - startMs;
  const pctOf = (iso: string): number => Math.min(100, Math.max(0, ((Date.parse(iso) - startMs) / span) * 100));

  const segments: Reading[] = Array.from({ length: buckets }, () => "none");
  for (const poll of polls) {
    const reading = READING[poll.overallStatus];
    const when = Date.parse(poll.observedAt);
    if (reading === undefined || when < startMs || when > endMs) continue;
    const index = Math.min(buckets - 1, Math.floor(((when - startMs) / span) * buckets));
    if (WORST[reading] > WORST[segments[index] ?? "none"]) segments[index] = reading;
  }

  const markers: Lifeline["markers"] = [
    { pct: 0, kind: "opened" as MarkerKind },
    ...actionLog.map((record): { pct: number; kind: MarkerKind } => ({ pct: pctOf(record.sentAt), kind: record.ok ? "alert" : "failed" })),
    ...notes.map((note): { pct: number; kind: MarkerKind } => ({ pct: pctOf(note.createdAt), kind: "note" })),
  ].sort((a, b) => a.pct - b.pct);
  markers.push({ pct: 100, kind: open ? "now" : "resolved" });

  return {
    fromIso: incident.startedAt,
    toIso: new Date(endMs).toISOString(),
    open,
    segments,
    markers,
  };
}

export type IncidentEvent =
  | { type: "opened"; at: string; declaredAt?: string | undefined; firstSeenAt?: string | undefined }
  | { type: "resolved"; at: string }
  | { type: "observed"; at: string; status: string }
  | { type: "sends"; at: string; burst: SendBurst }
  | { type: "note"; at: string; note: IncidentNote }
  | { type: "revision"; at: string; revision: IncidentRevision };

/**
 * Everything that happened, as one list, newest first. What used to be four
 * separate tiles — our observations, what was sent, the provider's later edits
 * and the operator's notes — are one story, and it reads in one order.
 */
export function buildEvents(input: {
  incident: IncidentRow;
  timeline: readonly TimelineEntry[];
  actionLog: readonly SentRecord[];
  notes: readonly IncidentNote[];
  revisions: readonly IncidentRevision[];
}): IncidentEvent[] {
  const { incident } = input;
  const events: IncidentEvent[] = [];
  for (const entry of input.timeline) {
    if (entry.label === "opened") {
      events.push({ type: "opened", at: entry.at, declaredAt: incident.declaredAt, firstSeenAt: incident.firstSeenAt });
    } else if (entry.label === "resolved") {
      events.push({ type: "resolved", at: entry.at });
    } else if (entry.status !== undefined) {
      events.push({ type: "observed", at: entry.at, status: entry.status });
    }
  }
  for (const burst of groupSends(input.actionLog)) events.push({ type: "sends", at: burst.at, burst });
  for (const note of input.notes) events.push({ type: "note", at: note.createdAt, note });
  for (const revision of input.revisions) events.push({ type: "revision", at: revision.observedAt, revision });
  // Stable for equal instants, so "opened" stays below the first send it caused.
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
