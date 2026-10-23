import { Router } from "express";
import { z } from "zod";
import { layoutSchema } from "../dashboardLayoutSchema.ts";
import { createDashboardStore } from "../dashboardStore.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { issues } from "./config.shared.ts";

const saveSchema = z.object({ layout: layoutSchema, updatedAt: z.string().min(1) });

/**
 * The composable Overview — roadmap 4.1. One dashboard, `default`, today; the
 * id in the path is there so named dashboards (4.2) are more rows, not new
 * routes.
 */
export function dashboardsRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();
  const store = createDashboardStore(runtime.db, runtime.logger);
  const unknown = (id: string) => ({ error: { message: `unknown dashboard: ${id}` } });

  router.get("/dashboards/:id", (req, res) => {
    const dashboard = store.get(req.params.id);
    if (dashboard === undefined) {
      res.status(404).json(unknown(req.params.id));
      return;
    }
    res.json(dashboard);
  });

  router.put("/dashboards/:id", (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    const result = store.save(req.params.id, parsed.data.layout, parsed.data.updatedAt);
    if (result === undefined) {
      res.status(404).json(unknown(req.params.id));
      return;
    }
    if (result.kind === "conflict") {
      res.status(409).json({
        error: { message: "the dashboard was saved elsewhere since this copy was read" },
        current: result.current,
      });
      return;
    }
    res.json(result.dashboard);
  });

  router.delete("/dashboards/:id/layout", (req, res) => {
    const dashboard = store.reset(req.params.id);
    if (dashboard === undefined) {
      res.status(404).json(unknown(req.params.id));
      return;
    }
    res.json(dashboard);
  });

  return router;
}
