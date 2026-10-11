import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Adapter, FetchContext, ServiceRef } from "../core/adapter.interface.ts";
import type { NormalizedStatus } from "../core/types.ts";
import {
  HEARTBEAT_ADAPTER_ID,
  heartbeatConfig,
  heartbeatProblems,
  heartbeatVerdict,
  type HeartbeatTimes,
} from "../core/heartbeat.ts";
import { getAdapter, registerAdapter } from "../adapters/index.ts";

/**
 * The UI edition's half of the dead-man's switch — roadmap 2.5: where a job's
 * pings are kept, and the `heartbeat` adapter that reads them.
 *
 * The adapter lives here rather than under `src/adapters` because the thing it
 * reads only exists here: the Light edition has no URL a job could call, so a
 * heartbeat in its `config.yml` is refused as an unknown adapter at load time
 * — said once, plainly — instead of polled forever into a reading that can
 * only ever be "missed".
 */

export interface HeartbeatRecord extends HeartbeatTimes {
  providerId: string;
  /** Pings received since the monitor was armed — a single one may be a test. */
  pings: number;
}

export interface HeartbeatLedger {
  /** Starts the clock for a monitor that has none yet; a no-op once it has. */
  arm(providerId: string, at: string): void;
  record(providerId: string, at: string): void;
  get(providerId: string): HeartbeatRecord | null;
  list(): HeartbeatRecord[];
}

const rowSchema = z.object({
  provider_id: z.string(),
  armed_at: z.string(),
  last_ping_at: z.string().nullable(),
  pings: z.number(),
});

const fromRow = (raw: unknown): HeartbeatRecord => {
  const row = rowSchema.parse(raw);
  return { providerId: row.provider_id, armedAt: row.armed_at, lastPingAt: row.last_ping_at, pings: row.pings };
};

export function createHeartbeatLedger(db: DatabaseSync): HeartbeatLedger {
  const arm = db.prepare("INSERT OR IGNORE INTO heartbeats (provider_id, armed_at) VALUES (?, ?)");
  const record = db.prepare(`
    INSERT INTO heartbeats (provider_id, armed_at, last_ping_at, pings) VALUES (?, ?, ?, 1)
    ON CONFLICT (provider_id) DO UPDATE SET last_ping_at = excluded.last_ping_at, pings = pings + 1
  `);
  const select = db.prepare("SELECT provider_id, armed_at, last_ping_at, pings FROM heartbeats WHERE provider_id = ?");
  const selectAll = db.prepare("SELECT provider_id, armed_at, last_ping_at, pings FROM heartbeats");
  return {
    arm(providerId, at) {
      arm.run(providerId, at);
    },
    record(providerId, at) {
      record.run(providerId, at, at);
    },
    get(providerId) {
      const raw = select.get(providerId);
      return raw === undefined ? null : fromRow(raw);
    },
    list() {
      return selectAll.all().map(fromRow);
    },
  };
}

/** `3h 10m`, `45m`, `2d 4h` — the two largest units, which is all a late job needs. */
function elapsed(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  return `${rest}m`;
}

/**
 * The ledger the registered adapter reads. The adapter registry is
 * process-wide, and so is this binding: production runs one UI runtime per
 * process, and a test that builds a second one rebinds it to the newer
 * database, which is the one it is about to poll.
 */
let current: HeartbeatLedger | null = null;

export const heartbeatAdapter: Adapter = {
  id: HEARTBEAT_ADAPTER_ID,
  version: 1,
  // Our own observation, not a page somebody publishes: no freshness to track,
  // no page latency to judge, and the record for the provider is what we saw.
  kind: "probe",

  validateOptions: heartbeatProblems,

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    if (current === null) throw new Error(`heartbeat ${service.id}: no heartbeat ledger in this edition`);
    const config = heartbeatConfig(service.options);
    const now = new Date();
    current.arm(service.id, now.toISOString());
    const times = current.get(service.id)!;
    const verdict = heartbeatVerdict(config, times, now);

    if (verdict.status !== "operational") {
      ctx.onNote?.({
        text:
          times.lastPingAt === null
            ? `no ping since the monitor was armed ${elapsed(now.getTime() - Date.parse(times.armedAt))} ago`
            : `last ping ${elapsed(now.getTime() - Date.parse(times.lastPingAt))} ago, expected every ${elapsed(config.everySeconds * 1000)}`,
      });
    }

    return {
      provider: service.id,
      overallStatus: verdict.status,
      activeIncidents: [],
      components: [],
      maintenances: [],
      fetchedAt: now.toISOString(),
    };
  },
};

/** Binds the adapter to this runtime's database, registering it on first use. */
export function useHeartbeatLedger(db: DatabaseSync): HeartbeatLedger {
  current = createHeartbeatLedger(db);
  let registered = true;
  try {
    getAdapter(HEARTBEAT_ADAPTER_ID);
  } catch {
    registered = false;
  }
  if (!registered) registerAdapter(heartbeatAdapter);
  return current;
}
