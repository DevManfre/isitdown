import { Router } from "express";
import type { UiRuntimeCore } from "../runtime.ts";

/** The only windows the dashboard offers, so the only ones the API serves. */
const ALLOWED_DAYS = [7, 30, 90] as const;
const DEFAULT_DAYS = 90;

/**
 * Parsed by hand rather than through a coercing schema: a bad value must be told
 * which windows exist, and a coercion failure would answer "expected number,
 * received nan" instead.
 */
function parseDays(raw: unknown): number | null {
  if (raw === undefined) return DEFAULT_DAYS;
  const value = Number(raw);
  return (ALLOWED_DAYS as readonly number[]).includes(value) ? value : null;
}

/**
 * Pre-aggregated history. The frontend never re-derives a percentage or a daily
 * bucket from raw samples: both the uptime bars and the incident timeline come
 * from here, so the two views cannot disagree about a window.
 */
export function historyRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

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
