import { Router } from "express";
import type { UiRuntimeCore } from "../runtime.ts";
import { ALLOWED_DAYS, CALENDAR_DAYS, parseDays } from "./historyWindow.ts";

/**
 * Pre-aggregated history. The frontend never re-derives a percentage or a daily
 * bucket from raw samples: both the uptime bars and the incident timeline come
 * from here, so the two views cannot disagree about a window.
 */
export function historyRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  /**
   * A year of day cells for one provider — roadmap 5.20. Fixed at
   * `CALENDAR_DAYS` rather than taking a `days`: the calendar is one view with
   * one window, and the window it draws is in the answer so a stored response
   * still says what it covers.
   */
  router.get("/history/calendar", async (req, res) => {
    const provider = req.query["provider"];
    if (typeof provider !== "string" || provider === "") {
      res.status(400).json({ error: { message: "provider is required" } });
      return;
    }
    if (!runtime.listAllServices().some((service) => service.id === provider)) {
      res.status(404).json({ error: { message: `unknown provider: ${provider}` } });
      return;
    }
    res.json(await runtime.history.getProviderCalendar(provider, CALENDAR_DAYS));
  });

  router.get("/history/components", async (req, res) => {
    const days = parseDays(req.query["days"] ?? undefined);
    if (days === null) {
      res.status(400).json({ error: { message: `days must be one of ${ALLOWED_DAYS.join(", ")}` } });
      return;
    }
    const provider = req.query["provider"];
    if (typeof provider !== "string" || provider === "") {
      res.status(400).json({ error: { message: "provider is required" } });
      return;
    }
    const service = runtime.listAllServices().find((entry) => entry.id === provider);
    if (service === undefined) {
      res.status(404).json({ error: { message: `unknown provider: ${provider}` } });
      return;
    }
    res.json({
      provider,
      days,
      components: await runtime.history.getComponentHistories(provider, service.components, days),
    });
  });

  router.get("/history", async (req, res) => {
    const days = parseDays(req.query["days"] ?? undefined);
    if (days === null) {
      res
        .status(400)
        .json({ error: { message: `days must be one of ${ALLOWED_DAYS.join(", ")}` } });
      return;
    }

    const { intervalMinutes } = (await runtime.configSource.load()).polling;
    const provider = req.query["provider"];

    if (typeof provider === "string" && provider !== "") {
      const known = runtime.listAllServices().some((service) => service.id === provider);
      if (!known) {
        res.status(404).json({ error: { message: `unknown provider: ${provider}` } });
        return;
      }
      res.json(await runtime.history.getProviderHistory(provider, days, intervalMinutes));
      return;
    }

    // The fleet-wide view of what is being watched: a disabled provider leaves
    // the table and stops moving the aggregate, but keeps its stored history for
    // the day it is switched back on.
    res.json(await runtime.history.getSummary(days, intervalMinutes, runtime.enabledProviderIds()));
  });

  return router;
}
