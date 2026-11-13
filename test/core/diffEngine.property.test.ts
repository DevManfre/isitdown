import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmedChanges, signatureOf } from "../../src/core/diffEngine.ts";
import { activeWindows } from "../../src/core/maintenance.ts";
import type {
  DampingState,
  Incident,
  MaintenanceWindow,
  NormalizedStatus,
  OverallStatus,
  StatusChange,
} from "../../src/core/types.ts";

/*
 * Property-based check of the diff engine (roadmap 13.1).
 *
 * The table-driven suite beside this one pins the transitions someone thought
 * of; this one throws seeded random sequences of readings at the same gate the
 * poller calls — `confirmedChanges`, baseline, last sample and damping state
 * carried from step to step exactly as the store would — and checks, at every
 * step, the promises a notification product cannot break.
 *
 * No dependency: a 32-bit seeded generator and a naive shrinker (drop steps
 * while it still fails) are all a sequence of readings needs. A failure prints
 * the seed and the minimal sequence; `PBT_SEED=<n>` replays exactly that run,
 * `PBT_RUNS=<n>` changes how many sequences one run tries.
 */

const RUNS = Number(process.env.PBT_RUNS ?? 500);
const SEED = process.env.PBT_SEED === undefined
  ? Math.floor(Math.random() * 2 ** 32)
  : Number(process.env.PBT_SEED);

/** mulberry32: small, fast, and the same sequence for the same seed everywhere. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUSES: OverallStatus[] = [
  "operational", "degraded", "partial_outage", "major_outage", "unknown",
];
const START = Date.parse("2026-08-19T00:00:00.000Z");
const MINUTE = 60_000;

/**
 * One poll, described independently of when it lands: its time comes from its
 * position in the sequence, so the shrinker can drop any step and the rest
 * still make sense.
 */
interface Step {
  overall: OverallStatus;
  /** Open incidents, by id from a small pool so they reopen, update and close. */
  incidents: { id: string; status: string; impact: string }[];
  components: { id: string; status: OverallStatus }[];
  /** Window offsets in minutes from this poll; a negative start is running. */
  windows: { id: string; startsIn: number; lastsFor: number | null }[];
  /** Minutes from this poll the mute runs until; null for none. */
  mutedFor: number | null;
  /** A step that says "the page is fine now", repeated until the gate believes it. */
  recovery: boolean;
}

interface Run {
  confirmations: number;
  steps: Step[];
}

function generate(next: () => number): Run {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const chance = (p: number) => next() < p;
  const steps: Step[] = [];
  const length = 5 + Math.floor(next() * 40);
  // Sticky state, so sequences look like a page over time and not white noise:
  // most polls repeat the last one, which is where duplicates would show up.
  let current: Step = {
    overall: "operational", incidents: [], components: [], windows: [], mutedFor: null, recovery: false,
  };
  for (let i = 0; i < length; i++) {
    if (chance(0.08)) {
      steps.push({ ...current, recovery: true });
      current = { ...current, overall: "operational", incidents: [], windows: [], mutedFor: null };
      continue;
    }
    if (chance(0.55)) {
      current = {
        overall: chance(0.3) ? current.overall : pick(STATUSES),
        incidents: ["i1", "i2", "i3"].filter(() => chance(0.3)).map((id) => ({
          id,
          status: pick(["investigating", "identified", "monitoring"]),
          impact: pick(["minor", "major", "critical"]),
        })),
        components: ["c1", "c2"].filter(() => chance(0.7)).map((id) => ({ id, status: pick(STATUSES) })),
        windows: chance(0.2)
          ? [{ id: pick(["mw1", "mw2"]), startsIn: Math.floor(next() * 6) - 3, lastsFor: chance(0.2) ? null : 1 + Math.floor(next() * 5) }]
          : [],
        mutedFor: chance(0.1) ? Math.floor(next() * 4) - 1 : null,
        recovery: false,
      };
    }
    steps.push(current);
  }
  return { confirmations: 1 + Math.floor(next() * 3), steps };
}

function readingAt(step: Step, minute: number): { status: NormalizedStatus; mutedUntil: string | null } {
  const at = START + minute * MINUTE;
  const iso = (ms: number) => new Date(ms).toISOString();
  const incidents: Incident[] = step.incidents.map((incident) => ({
    ...incident, name: `Incident ${incident.id}`, updatedAt: iso(at),
  }));
  const maintenances: MaintenanceWindow[] = step.windows.map((window) => {
    const startsAt = at + window.startsIn * MINUTE;
    return {
      id: window.id,
      name: `Window ${window.id}`,
      status: window.startsIn <= 0 ? "in_progress" : "scheduled",
      startsAt: iso(startsAt),
      endsAt: window.lastsFor === null ? null : iso(startsAt + window.lastsFor * MINUTE),
      componentIds: [],
    };
  });
  return {
    status: {
      provider: "p",
      overallStatus: step.overall,
      activeIncidents: incidents,
      components: step.components.map((c) => ({ ...c, name: `Component ${c.id}` })),
      maintenances,
      fetchedAt: iso(at),
    },
    mutedUntil: step.mutedFor === null ? null : iso(at + step.mutedFor * MINUTE),
  };
}

const HEALTHY: Step = {
  overall: "operational", incidents: [], components: [], windows: [], mutedFor: null, recovery: false,
};

/** Replays a run through the gate and returns the first broken promise, or null. */
function check(run: Run): string | null {
  let baseline: NormalizedStatus | null = null;
  let last: NormalizedStatus | null = null;
  let pending: DampingState | null = null;
  let minute = 0;

  const poll = (step: Step) => {
    const { status, mutedUntil } = readingAt(step, minute++);
    const before = { baseline, last };
    const gate = confirmedChanges(status, {
      baseline, last, pending, confirmations: run.confirmations, mutedUntil,
    });
    baseline = gate.baseline;
    pending = gate.pending;
    last = status;
    return { status, mutedUntil, changes: gate.changes, before };
  };

  for (const [index, step] of run.steps.entries()) {
    if (step.recovery) {
      // The page says everything is fine, for as long as damping wants to hear
      // it. Every incident the operator still believes open must be closed.
      const believedOpen = new Set((baseline ?? last)?.activeIncidents.map((i) => i.id) ?? []);
      const resolved = new Set<string>();
      for (let i = 0; i < run.confirmations; i++) {
        for (const change of poll(HEALTHY).changes) {
          if (change.kind === "incident_resolved" && change.incident !== undefined) {
            resolved.add(change.incident.id);
          }
        }
      }
      for (const id of believedOpen) {
        if (!resolved.has(id)) return `step ${index}: incident ${id} was never resolved after the page recovered`;
      }
      const settled = baseline as NormalizedStatus | null;
      if (settled !== null && settled.activeIncidents.length > 0) {
        return `step ${index}: baseline still holds incidents after recovery`;
      }
      continue;
    }

    const { status, mutedUntil, changes, before } = poll(step);
    const broken = stepInvariant(status, mutedUntil, changes, before.baseline ?? before.last);
    if (broken !== null) return `step ${index}: ${broken}`;

    // The same reading again, a moment later, is old news: never a second
    // notification for a transition already announced.
    if (changes.length > 0) {
      const again = confirmedChanges(
        { ...status },
        { baseline, last, pending, confirmations: run.confirmations, mutedUntil },
      );
      if (again.changes.length > 0) {
        return `step ${index}: repeating the reading notified again: ${kinds(again.changes)}`;
      }
    }
  }
  return null;
}

function stepInvariant(
  status: NormalizedStatus,
  mutedUntil: string | null,
  changes: StatusChange[],
  against: NormalizedStatus | null,
): string | null {
  // No change of state, no event.
  if (against !== null && signatureOf(against) === signatureOf(status) && changes.length > 0) {
    return `an unchanged reading produced ${kinds(changes)}`;
  }

  // One event per transition, never two.
  const keys = changes.map((c) =>
    `${c.kind}:${c.incident?.id ?? c.component?.id ?? c.maintenance?.id ?? ""}`);
  if (new Set(keys).size !== keys.length) return `duplicate events in one poll: ${keys.join(", ")}`;

  // A mute silences everything; a running window everything but itself.
  if (mutedUntil !== null && Date.parse(status.fetchedAt) < Date.parse(mutedUntil) && changes.length > 0) {
    return `a muted reading produced ${kinds(changes)}`;
  }
  if (activeWindows(status).length > 0) {
    const leaked = changes.filter((c) => c.kind !== "maintenance_started" && c.kind !== "maintenance_ended");
    if (leaked.length > 0) return `a reading inside a window produced ${kinds(leaked)}`;
  }

  // A page we could not read is never a transition, in either direction:
  // not an outage, and above all not a recovery.
  for (const change of changes) {
    if (
      (change.kind === "status_change" || change.kind === "component_status_change") &&
      (change.previousStatus === "unknown" || change.currentStatus === "unknown" ||
        change.previousStatus === change.currentStatus)
    ) {
      return `${change.kind} ${change.previousStatus} → ${change.currentStatus}`;
    }
  }

  // A notified transition starts from what the operator was last told, not
  // from whichever sample damping held back in between.
  for (const change of changes) {
    if (change.kind === "status_change" && against !== null && change.previousStatus !== against.overallStatus) {
      return `status_change from ${change.previousStatus}, but the operator was last told ${against.overallStatus}`;
    }
  }
  return null;
}

const kinds = (changes: StatusChange[]) => changes.map((c) => c.kind).join(", ");

/** Drops steps one at a time while the run still fails, until none can go. */
function shrink(run: Run): Run {
  let smallest = run;
  for (let progress = true; progress;) {
    progress = false;
    for (let i = 0; i < smallest.steps.length; i++) {
      const candidate = { ...smallest, steps: smallest.steps.filter((_, j) => j !== i) };
      if (check(candidate) !== null) {
        smallest = candidate;
        progress = true;
        break;
      }
    }
  }
  return smallest;
}

test("the diff engine keeps its promises over seeded random sequences", (t) => {
  t.diagnostic(`PBT_SEED=${SEED}`);
  const next = rng(SEED);
  for (let i = 0; i < RUNS; i++) {
    const run = generate(next);
    const broken = check(run);
    if (broken === null) continue;
    const minimal = shrink(run);
    assert.fail(
      `sequence ${i} of PBT_SEED=${SEED} broke a promise: ${check(minimal)}\n` +
      `minimal run (confirmations ${minimal.confirmations}):\n` +
      minimal.steps.map((step, n) => `  ${n}: ${JSON.stringify(step)}`).join("\n"),
    );
  }
});
