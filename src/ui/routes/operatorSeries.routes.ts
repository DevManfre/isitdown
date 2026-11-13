import { Router } from "express";
import { z } from "zod";

import { addSeries, listSeries, newSeriesSchema, readSeries, removeSeries, type PromDeps } from "../operatorSeries.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { issues } from "./config.shared.ts";

/** The longest window one read covers: the incident timeline's own ceiling. */
const MAX_WINDOW_MS = 400 * 24 * 3600 * 1000;

const windowSchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

/**
 * The operator's own metric, roadmap 6.11: `/config/series` to declare one,
 * `/series/:id` to read it over a window. The read is a separate path from the
 * config list because it may call out to Prometheus, and a config page must not
 * wait on somebody else's server to paint.
 */
export function operatorSeriesRoutes(runtime: UiRuntimeCore, deps: Omit<PromDeps, "env"> = {}): Router {
  const router = Router();
  const db = runtime.db;

  router.get("/config/series", (_req, res) => {
    res.json({ series: listSeries(db) });
  });

  router.post("/config/series", (req, res) => {
    const parsed = newSeriesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    try {
      res.status(201).json(addSeries(db, parsed.data));
    } catch (error) {
      res.status(400).json({ error: { message: error instanceof Error ? error.message : String(error) } });
    }
  });

  router.delete("/config/series/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !removeSeries(db, id)) {
      res.status(404).json({ error: { message: `unknown series: ${req.params.id}` } });
      return;
    }
    res.status(204).end();
  });

  router.get("/series/:id", async (req, res) => {
    const id = Number(req.params.id);
    const parsed = windowSchema.safeParse(req.query);
    if (!Number.isInteger(id) || !parsed.success) {
      res.status(400).json({ error: { message: parsed.success ? "the series id is a number" : issues(parsed.error) } });
      return;
    }
    const from = new Date(parsed.data.from);
    const to = new Date(parsed.data.to);
    if (to <= from || to.getTime() - from.getTime() > MAX_WINDOW_MS) {
      res.status(400).json({ error: { message: "the window must run forwards and span at most 400 days" } });
      return;
    }
    try {
      const reading = await readSeries(db, id, from, to, { env: runtime.env, ...deps, ...runtime.seriesDeps });
      if (reading === null) {
        res.status(404).json({ error: { message: `unknown series: ${req.params.id}` } });
        return;
      }
      res.json(reading);
    } catch (error) {
      // Somebody else's server failing is not this request being wrong.
      res.status(502).json({ error: { message: error instanceof Error ? error.message : String(error) } });
    }
  });

  return router;
}
