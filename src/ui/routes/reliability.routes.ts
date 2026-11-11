import { Router } from "express";
import { countTerms, rankComponents } from "../incidentWords.ts";
import { ALLOWED_DAYS, parseDays } from "./historyWindow.ts";
import type { UiRuntimeCore } from "../runtime.ts";

/**
 * Reliability per provider, and when incidents actually happen — roadmap 12.2
 * and 12.3.
 *
 * One endpoint for both because they are one query over one table read two
 * ways, and splitting them would make the dashboard walk the incident history
 * twice to draw two things on the same screen.
 */
export function reliabilityRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  router.get("/reliability", async (req, res) => {
    const days = parseDays(req.query["days"] ?? undefined);
    if (days === null) {
      res
        .status(400)
        .json({
          error: { message: `days must be one of ${ALLOWED_DAYS.join(", ")}` },
        });
      return;
    }
    // Enabled only, like the history summary: a disabled provider leaves the
    // table without its rows being forgotten.
    res.json(
      await runtime.reliability.getReport(days, runtime.enabledProviderIds()),
    );
  });

  /**
   * What keeps breaking — roadmap 6.9: the words in the window's incident
   * titles, and the selected components by days spent not operational.
   */
  router.get("/reliability/words", async (req, res) => {
    const days = parseDays(req.query["days"] ?? undefined);
    if (days === null) {
      res
        .status(400)
        .json({
          error: { message: `days must be one of ${ALLOWED_DAYS.join(", ")}` },
        });
      return;
    }
    const enabled = runtime.enabledProviderIds();
    const incidents = await runtime.store.listIncidents({
      providerIds: enabled,
      days,
    });
    const services = runtime
      .listAllServices()
      .filter(
        (service) =>
          enabled.includes(service.id) && service.components.length > 0,
      );
    const components = await Promise.all(
      services.map(async (service) => ({
        providerId: service.id,
        components: await runtime.history.getComponentHistories(
          service.id,
          service.components,
          days,
        ),
      })),
    );
    res.json({
      days,
      incidents: incidents.length,
      ...countTerms(incidents),
      components: rankComponents(components),
    });
  });

  return router;
}
