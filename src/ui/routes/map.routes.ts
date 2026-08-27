import { Router } from "express";
import type { UiRuntimeCore } from "../runtime.ts";

/**
 * The Overview's geographic card reads this.
 *
 * A pure read of the map lane's stored snapshot: it never reaches upstream, for
 * the same reason `/status` does not — the card refetches on the dashboard's
 * idle rhythm, and a view that polls a provider on every render is how a local
 * dashboard becomes a load source.
 *
 * Points are served raw, not binned. The grid a marker lands in depends on the
 * base map's resolution and the rendered width, which only the browser knows,
 * and the globe needs unbinned points regardless.
 */
export function mapRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  router.get("/map", (_req, res) => {
    // A disabled provider is not being measured, so it is not drawn — the same
    // rule the Overview's fleet already applies.
    const enabled = new Map(
      runtime.listAllServices().filter((service) => service.enabled).map((service) => [service.id, service.name]),
    );

    const located = runtime.mapStore.listPoints().filter((point) => enabled.has(point.providerId));

    const points = located.map((point) => ({
      providerId: point.providerId,
      providerName: enabled.get(point.providerId) as string,
      componentId: point.componentId,
      name: point.name,
      lat: point.lat,
      lon: point.lon,
      status: point.status,
      source: point.source,
    }));

    const unlocated = runtime.mapStore
      .listGeoState()
      .filter((state) => enabled.has(state.providerId))
      .map((state) => ({
        providerId: state.providerId,
        providerName: enabled.get(state.providerId) as string,
        count: state.total - state.located,
      }))
      .filter((entry) => entry.count > 0);

    // The newest observation across the snapshot, not the time this response
    // was built: when the lane's own fetch has been failing, the card must be
    // able to say how old what it is drawing actually is.
    const generatedAt = located.reduce<string | null>(
      (newest, point) => (newest === null || point.observedAt > newest ? point.observedAt : newest),
      null,
    );

    res.json({ points, unlocated, generatedAt });
  });

  return router;
}
