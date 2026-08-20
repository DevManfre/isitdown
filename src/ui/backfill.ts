import type { Adapter } from "../core/adapter.interface.ts";
import type { ConfigSource, PollingConfig, ServiceDefinition } from "../core/configSource.interface.ts";
import type { HistoricalIncident, OverallStatus } from "../core/types.ts";
import type { Logger } from "../core/logger.ts";
import type { HistoryStore, SampleRow } from "./historyStore.interface.ts";

/** How far back the bars can possibly reach; the 90-day view is the widest. */
export const BACKFILL_DAYS = 90;

/**
 * What a historical incident's impact says about the samples under it. Unknown
 * words map to `degraded`, not `major_outage` as the live indicator does: an
 * incident of unknown impact is by definition at least a degradation, while
 * inventing a full outage would paint false red over reconstructed history.
 */
const IMPACT_STATUS: Record<string, OverallStatus> = {
  minor: "degraded",
  major: "partial_outage",
  critical: "major_outage",
};

const IMPACT_RANK: Record<string, number> = {
  operational: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
};

/**
 * Reconstructs poll samples for the window [max(from, coverageStart), to) on a
 * grid of `intervalMinutes`, anchored at `from`. `to` is exclusive so a derived
 * sample can never collide with the earliest real one. A slot under no incident
 * is operational: the feed said nothing happened then, and it covers that time.
 */
export function deriveSamples(
  incidents: HistoricalIncident[],
  coverageStart: string | null,
  from: string,
  to: string,
  intervalMinutes: number,
): SampleRow[] {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const startMs = coverageStart === null ? fromMs : Math.max(fromMs, Date.parse(coverageStart));
  const stepMs = intervalMinutes * 60_000;

  const windows = incidents
    .map((incident) => ({
      start: Date.parse(incident.startedAt),
      end: incident.resolvedAt === null ? toMs : Date.parse(incident.resolvedAt),
      status: IMPACT_STATUS[incident.impact] ?? "degraded",
    }))
    .filter((window) => !Number.isNaN(window.start) && !Number.isNaN(window.end));

  const samples: SampleRow[] = [];
  for (let at = fromMs; at < toMs; at += stepMs) {
    if (at < startMs) continue;
    let worst: OverallStatus = "operational";
    for (const window of windows) {
      if (at >= window.start && at < window.end && IMPACT_RANK[window.status]! > IMPACT_RANK[worst]!) {
        worst = window.status;
      }
    }
    samples.push({
      observedAt: new Date(at).toISOString(),
      overallStatus: worst,
      ok: worst === "operational",
    });
  }
  return samples;
}

const DAY_MS = 24 * 3600 * 1000;

export interface BackfillService {
  backfillAll(): Promise<void>;
  backfillOne(serviceId: string): Promise<void>;
}

export interface BackfillDeps {
  getAdapter: (id: string) => Adapter;
  store: Pick<HistoryStore, "getEarliestSampleTime" | "applyBackfill">;
  configSource: ConfigSource;
  logger: Logger;
  /** Injected so the window does not depend on when a test runs. */
  now?: (() => Date) | undefined;
}

/**
 * Reconstructs history from each provider's public incident feed. It writes
 * only through `applyBackfill` — never `saveStatus` — so `provider_state` stays
 * null and the first real poll remains a baseline: no notification can come out
 * of reconstructed history. A failure here costs nothing but an emptier chart,
 * so every error is a warning, never a crash.
 */
export function createBackfillService(deps: BackfillDeps): BackfillService {
  const now = deps.now ?? (() => new Date());

  async function backfillProvider(service: ServiceDefinition, polling: PollingConfig): Promise<void> {
    const adapter = deps.getAdapter(service.adapter);
    if (adapter.fetchIncidentHistory === undefined) return;

    const from = new Date(now().getTime() - BACKFILL_DAYS * DAY_MS).toISOString();
    const to = (await deps.store.getEarliestSampleTime(service.id)) ?? now().toISOString();
    if (to <= from) return; // already backfilled, or 90 days of real samples exist

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
    const samples = deriveSamples(
      history.incidents,
      history.coverageStart,
      from,
      to,
      polling.intervalMinutes,
    );
    await deps.store.applyBackfill(service.id, { samples, incidents: history.incidents });
    deps.logger.info("history backfilled", {
      providerId: service.id,
      samples: samples.length,
      incidents: history.incidents.length,
      coverageStart: history.coverageStart ?? from,
    });
  }

  async function attempt(service: ServiceDefinition, polling: PollingConfig): Promise<void> {
    try {
      await backfillProvider(service, polling);
    } catch (error) {
      deps.logger.warn("history backfill failed", {
        providerId: service.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    async backfillAll(): Promise<void> {
      try {
        const config = await deps.configSource.load();
        // Sequential on purpose: this is a boot-time nicety, not a poll cycle.
        for (const service of config.services) await attempt(service, config.polling);
      } catch (error) {
        deps.logger.warn("history backfill failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async backfillOne(serviceId: string): Promise<void> {
      try {
        const config = await deps.configSource.load();
        const service = config.services.find((entry) => entry.id === serviceId);
        if (service === undefined) return; // unknown or disabled: nothing to do
        await attempt(service, config.polling);
      } catch (error) {
        deps.logger.warn("history backfill failed", {
          providerId: serviceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
