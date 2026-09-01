import type { Adapter } from "../core/adapter.interface.ts";
import type { ServiceDefinition } from "../core/configSource.interface.ts";
import type { Logger } from "../core/logger.ts";
import { resolveLocation, type GeoTables } from "./geo/resolveLocation.ts";
import type { MapStore, StoredMapPoint } from "./mapStore.ts";

/**
 * How often the lane re-reads the fleet's component lists. A constant, not a
 * setting: nobody has a reason to tune this before the map has ever been
 * used, and every knob added to Settings is one more an operator has to
 * understand.
 */
export const MAP_REFRESH_MS = 15 * 60 * 1000;

/**
 * How long a provider with nothing located stays skipped. The skip exists so
 * GitHub's dozen functional components are not re-fetched every quarter hour;
 * it expires because a provider can start naming regions it did not name
 * before, and a permanent verdict would never notice that.
 */
const RECHECK_AFTER_MS = 24 * 3600 * 1000;

export interface MapLaneDeps {
  store: MapStore;
  tables: GeoTables;
  logger: Logger;
  getAdapter: (id: string) => Adapter;
  listServices: () => ServiceDefinition[];
  timeoutMs: number;
}

export interface MapLane {
  /** One pass over the fleet. `now` is injectable so the suite controls the clock. */
  refresh(now?: Date): Promise<void>;
  start(): void;
  stop(): void;
}

/**
 * The lane that feeds the Overview's geographic card.
 *
 * It is deliberately not part of the poll cycle. `NormalizedStatus.components`
 * feeds the diff engine, which emits one `component_status_change` per changed
 * component — so carrying a provider's full component list through there would
 * turn a single Cloudflare edge event into hundreds of notifications. This lane
 * has no access to the diff engine or the dispatcher at all, which is what
 * makes that impossible rather than merely discouraged.
 */
export function createMapLane(deps: MapLaneDeps): MapLane {
  let timer: NodeJS.Timeout | undefined;
  // True while a refresh started by the interval is still running. Guards
  // against overlap: without it, a fleet slow enough for one pass to exceed
  // MAP_REFRESH_MS would have the next tick start a second pass over the
  // first, hitting every adapter twice at once.
  //
  // `scheduler.ts` solves the same overlap problem by chaining a fresh
  // setTimeout after each cycle rather than using setInterval at all — right
  // for the poll cycle, which also has to track exactly when the next cycle
  // is armed (the dashboard's countdown reads it) and jitters the delay so a
  // fleet of containers does not hit every provider on the same second. This
  // lane has no countdown to keep honest and nothing downstream ever asks
  // when it will next run (`MapLane` exposes only `refresh`/`start`/`stop`),
  // so adopting that whole chained-timer/jitter machinery would be solving a
  // problem this lane doesn't have. A boolean guard on the existing
  // setInterval is the smaller change that solves the actual one.
  let refreshing = false;

  async function refreshProvider(service: ServiceDefinition, now: Date): Promise<void> {
    const adapter = deps.getAdapter(service.adapter);
    // An adapter with no component listing simply has nothing to place — the
    // same shape as the picker's own optional capability.
    if (adapter.listComponents === undefined) return;

    const components = await adapter.listComponents(
      {
        id: service.id,
        name: service.name,
        baseUrl: service.baseUrl,
        options: service.options,
        components: service.components,
        scopeToComponents: service.scopeToComponents,
      },
      { timeoutMs: deps.timeoutMs },
    );

    const observedAt = now.toISOString();
    const points: Omit<StoredMapPoint, "providerId">[] = [];
    for (const component of components) {
      const point = resolveLocation(component.name, deps.tables);
      if (point === null) continue;
      points.push({
        componentId: component.id,
        name: component.name,
        lat: point.lat,
        lon: point.lon,
        source: point.source,
        status: component.status,
        observedAt,
      });
    }

    deps.store.replaceProvider(service.id, points, {
      located: points.length,
      total: components.length,
      checkedAt: observedAt,
    });
  }

  async function runRefresh(now: Date): Promise<void> {
    const skipUntil = new Map(
      deps.store
        .listGeoState()
        .filter((state) => state.located === 0)
        .map((state) => [state.providerId, Date.parse(state.checkedAt) + RECHECK_AFTER_MS]),
    );

    for (const service of deps.listServices()) {
      // A disabled provider is one the operator has told the poller to
      // skip, so nothing about it is measured — the Overview already
      // leaves it out of the fleet, and the map follows the same rule.
      if (!service.enabled) continue;

      const until = skipUntil.get(service.id);
      if (until !== undefined && now.getTime() < until) continue;

      try {
        await refreshProvider(service, now);
      } catch (error) {
        // One provider's outage must not cost the others their markers.
        // Its previous snapshot stays in place; `observedAt` carries its age.
        deps.logger.warn("map lane refresh failed", {
          provider: service.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    refresh(now = new Date()): Promise<void> {
      return runRefresh(now);
    },

    start(): void {
      if (timer !== undefined) return;
      // A local closure, not `this.refresh()`: the callback below is handed
      // to `setInterval`, which invokes it with no receiver, so a method that
      // reads `this` only works by the accident of how `start` itself
      // happened to be called. `runRefresh` needs no `this` at all.
      timer = setInterval(() => {
        if (refreshing) return;
        refreshing = true;
        void runRefresh(new Date())
          .catch((error: unknown) => {
            deps.logger.error("map lane cycle failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => {
            refreshing = false;
          });
      }, MAP_REFRESH_MS);
      timer.unref();
    },

    stop(): void {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}
