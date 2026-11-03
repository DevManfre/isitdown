import { Router } from "express";
import { listServices } from "../dbConfigSource.ts";
import {
  clampSide,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  renderFleetPng,
  renderFleetSvg,
  type FleetImageRow,
} from "../fleetImage.ts";
import type { UiRuntimeCore } from "../runtime.ts";

/**
 * The fleet as a still picture — roadmap 4.25. `/render/fleet.png?w=800&h=480`
 * for an e-ink frame or a chat, `/render/fleet.svg` for the same page as vector
 * text. A pure read of stored state, like the badge: no provider is contacted.
 *
 * A short cache for the same reason the badge has one — an e-ink panel
 * refreshes on a timer of minutes, and a picture an hour stale is worse than a
 * slightly chatty one.
 */
export function renderRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  const fleet = async (): Promise<FleetImageRow[]> =>
    Promise.all(
      listServices(runtime.db)
        .filter((service) => service.enabled)
        .map(async (service) => ({
          name: service.name,
          status: (await runtime.store.getState(service.id)).last?.overallStatus ?? "unknown",
        })),
    );

  router.get("/render/fleet.png", async (req, res) => {
    const png = renderFleetPng(
      await fleet(),
      clampSide(req.query.w, DEFAULT_WIDTH),
      clampSide(req.query.h, DEFAULT_HEIGHT),
    );
    res.type("image/png").set("cache-control", "max-age=60, s-maxage=60").send(png);
  });

  router.get("/render/fleet.svg", async (req, res) => {
    const svg = renderFleetSvg(
      await fleet(),
      clampSide(req.query.w, DEFAULT_WIDTH),
      clampSide(req.query.h, DEFAULT_HEIGHT),
    );
    res.type("image/svg+xml").set("cache-control", "max-age=60, s-maxage=60").send(svg);
  });

  return router;
}
