import type { DatabaseSync } from "node:sqlite";
import type { Adapter } from "../core/adapter.interface.ts";
import type { ConfigSource, PollingConfig, ServiceDefinition } from "../core/configSource.interface.ts";
import type { Logger } from "../core/logger.ts";
import type { HistoricalIncident } from "../core/types.ts";

/**
 * Retroactive incident edits — roadmap 1.11.
 *
 * Status pages rewrite resolved incidents quietly: the duration shrinks, the
 * impact drops a step, and the history a provider shows next quarter is kinder
 * than the one it showed on the day. This keeps the first version of every
 * resolved incident read back from the provider's own feed and compares each
 * later read against it. A difference is recorded once, as an entry on the
 * incident's page and a count on the trust card — never as a notification: an
 * edit to last month's incident is evidence about the page, not news to wake
 * anybody for.
 *
 * Only three fields are compared, because only they change what the incident
 * *meant*: its impact, when it started and when it ended. A reworded title is
 * a provider fixing a typo far more often than a provider hiding anything.
 */

export type RevisedField = "impact" | "started_at" | "resolved_at";

export interface IncidentRevision {
  field: RevisedField;
  before: string;
  after: string;
  /** ISO 8601, UTC. When the edit was first noticed — not when the provider made it, which no page says. */
  observedAt: string;
}

/** The first version of a resolved incident, the thing every later read is held to. */
export interface IncidentVersion {
  impact: string;
  startedAt: string;
  resolvedAt: string;
}

/** How often each provider's incident feed is read back. Edits are slow; a day's delay costs nothing. */
export const REVISION_CHECK_INTERVAL_MS = 6 * 60 * 60_000;

/** Two stamps name the same instant, whatever offset each is written with. */
function sameInstant(a: string, b: string): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  // Unparseable on either side: nothing can be said, so nothing is claimed.
  if (Number.isNaN(left) || Number.isNaN(right)) return true;
  return left === right;
}

/** The fields a later read changed, against the first version. Empty when it changed none. */
export function revisionsBetween(
  first: IncidentVersion,
  next: Pick<HistoricalIncident, "impact" | "startedAt" | "resolvedAt">,
): { field: RevisedField; before: string; after: string }[] {
  const changes: { field: RevisedField; before: string; after: string }[] = [];
  // An empty impact is a page that does not state one, not a page that removed it.
  if (first.impact !== "" && next.impact !== "" && first.impact !== next.impact) {
    changes.push({ field: "impact", before: first.impact, after: next.impact });
  }
  if (!sameInstant(first.startedAt, next.startedAt)) {
    changes.push({ field: "started_at", before: first.startedAt, after: next.startedAt });
  }
  if (next.resolvedAt !== null && !sameInstant(first.resolvedAt, next.resolvedAt)) {
    changes.push({ field: "resolved_at", before: first.resolvedAt, after: next.resolvedAt });
  }
  return changes;
}

export interface RevisionDeps {
  db: DatabaseSync;
  getAdapter: (id: string) => Adapter;
  configSource: ConfigSource;
  logger: Logger;
  /** Injected so a test can say when an edit was noticed. */
  now?: (() => Date) | undefined;
}

export function createRevisionService(deps: RevisionDeps) {
  const { db, logger } = deps;
  const now = deps.now ?? (() => new Date());

  const selectVersion = db.prepare(
    "SELECT impact, started_at, resolved_at FROM incident_versions WHERE provider_id = ? AND incident_id = ?",
  );
  const insertVersion = db.prepare(
    `INSERT OR IGNORE INTO incident_versions (provider_id, incident_id, impact, started_at, resolved_at, read_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const selectLive = db.prepare(
    "SELECT impact, resolved_at FROM incidents WHERE provider_id = ? AND incident_id = ?",
  );
  const insertRevision = db.prepare(
    `INSERT OR IGNORE INTO incident_revisions (provider_id, incident_id, field, before, after, observed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const selectRevisions = db.prepare(
    `SELECT field, before, after, observed_at FROM incident_revisions
     WHERE provider_id = ? AND incident_id = ? ORDER BY observed_at ASC, id ASC`,
  );
  const countResolved = db.prepare(
    "SELECT COUNT(*) AS total FROM incident_versions WHERE provider_id = ? AND resolved_at >= ?",
  );
  const countRevised = db.prepare(
    `SELECT COUNT(DISTINCT r.incident_id) AS total FROM incident_revisions r
     JOIN incident_versions v ON v.provider_id = r.provider_id AND v.incident_id = r.incident_id
     WHERE r.provider_id = ? AND v.resolved_at >= ?`,
  );

  /**
   * Folds one feed read into the stored versions. Returns how many edits it
   * found that were not already on record.
   */
  function record(providerId: string, incidents: HistoricalIncident[]): number {
    const at = now().toISOString();
    let found = 0;
    for (const incident of incidents) {
      // Still open: a page changing an incident it is still working on is the
      // page doing its job.
      if (incident.resolvedAt === null) continue;
      const live = selectLive.get(providerId, incident.id) as
        | { impact: string; resolved_at: string | null }
        | undefined;
      // Open in our own reading even though the feed calls it closed: the two
      // are a poll apart, and comparing now would race the resolution itself.
      if (live !== undefined && live.resolved_at === null) continue;

      const stored = selectVersion.get(providerId, incident.id) as
        | { impact: string; started_at: string; resolved_at: string }
        | undefined;
      if (stored === undefined) {
        // The first version takes the impact already on record — the one last
        // seen live, or the one backfill read before any of this ran. A
        // downgrade made at resolution is the commonest rewrite there is, and
        // it would be invisible if the baseline were the already-edited feed.
        // The times cannot be taken the same way: a live row's are our polls,
        // not the provider's stamps, so they would always "differ".
        const known = live !== undefined && live.impact !== "";
        const first: IncidentVersion = {
          impact: known ? live.impact : incident.impact,
          startedAt: incident.startedAt,
          resolvedAt: incident.resolvedAt,
        };
        insertVersion.run(providerId, incident.id, first.impact, first.startedAt, first.resolvedAt, at);
        for (const change of revisionsBetween(first, incident)) {
          found += Number(insertRevision.run(providerId, incident.id, change.field, change.before, change.after, at).changes);
        }
        continue;
      }
      const first: IncidentVersion = {
        impact: stored.impact,
        startedAt: stored.started_at,
        resolvedAt: stored.resolved_at,
      };
      for (const change of revisionsBetween(first, incident)) {
        found += Number(insertRevision.run(providerId, incident.id, change.field, change.before, change.after, at).changes);
      }
    }
    return found;
  }

  async function checkOne(service: ServiceDefinition, polling: PollingConfig): Promise<void> {
    const adapter = deps.getAdapter(service.adapter);
    if (adapter.fetchIncidentHistory === undefined) return;
    try {
      const history = await adapter.fetchIncidentHistory(
        {
          id: service.id,
          name: service.name,
          baseUrl: service.baseUrl,
          options: service.options,
          components: service.components,
          scopeToComponents: service.scopeToComponents,
        },
        { timeoutMs: polling.requestTimeoutSeconds * 1000 },
      );
      const found = record(service.id, history.incidents);
      if (found > 0) {
        logger.warn("a provider edited incidents it had already resolved", { providerId: service.id, edits: found });
      }
    } catch (error) {
      // The same rule backfill follows: a feed that cannot be read costs a
      // missed comparison, never the poller.
      logger.warn("reading back a provider's incident history failed", {
        providerId: service.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    record,

    /** Reads every enabled provider's feed back once, one at a time. */
    async checkAll(): Promise<void> {
      try {
        const config = await deps.configSource.load();
        for (const service of config.services) {
          if (service.enabled) await checkOne(service, config.polling);
        }
      } catch (error) {
        logger.warn("reading back incident histories failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    /** Every recorded edit to one incident, oldest first. */
    revisions(providerId: string, incidentId: string): IncidentRevision[] {
      const rows = selectRevisions.all(providerId, incidentId) as {
        field: RevisedField;
        before: string;
        after: string;
        observed_at: string;
      }[];
      return rows.map((row) => ({
        field: row.field,
        before: row.before,
        after: row.after,
        observedAt: row.observed_at,
      }));
    },

    /**
     * How many of a provider's incidents resolved inside the window were edited
     * afterwards, against how many were read back at all — the trust card's
     * fourth axis. `resolved` is the denominator on purpose: a page with no
     * history feed reads back nothing, and "0 edited" there would claim an
     * honesty nobody measured.
     */
    summary(providerId: string, days: number, at = now()): { revised: number; resolved: number } {
      const from = new Date(at.getTime() - days * 24 * 60 * 60_000).toISOString();
      const resolved = (countResolved.get(providerId, from) as { total: number }).total;
      const revised = (countRevised.get(providerId, from) as { total: number }).total;
      return { revised, resolved };
    },
  };
}

export type RevisionService = ReturnType<typeof createRevisionService>;
