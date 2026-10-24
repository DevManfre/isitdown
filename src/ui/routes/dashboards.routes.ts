import { Router, type Response } from "express";
import { z } from "zod";
import { layoutSchema } from "../dashboardLayoutSchema.ts";
import {
  createDashboardStore,
  MAX_DASHBOARDS,
  MAX_NAME_LENGTH,
  type CreateResult,
  type RestoreResult,
} from "../dashboardStore.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { issues } from "./config.shared.ts";

const saveSchema = z.object({ layout: layoutSchema, updatedAt: z.string().min(1) });
const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);
const createSchema = z.object({ name: nameSchema, layout: layoutSchema.optional() }).strict();
const updateSchema = z
  .object({
    name: nameSchema.optional(),
    // Home is handed over, never put down: the way to stop one being home is to
    // make another one home.
    home: z.literal(true).optional(),
  })
  .strict();
/** What a delete answered, sent back to undo it. Ids are the slugs `create` makes, nothing else. */
const restoreSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(40),
    name: nameSchema,
    layout: z.string().nullable(),
    position: z.number().int().min(0),
    home: z.boolean(),
  })
  .strict();
const importSchema = z
  .object({
    format: z.literal("isitdown.dashboard"),
    version: z.literal(1),
    name: nameSchema,
    layout: layoutSchema,
  })
  .strict();

/**
 * The composable Overview — roadmap 4.1 — and its named siblings (4.2). The
 * first install's dashboard is `default`; every other one is a row with an id
 * taken from the name it was created with.
 */
export function dashboardsRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();
  const store = createDashboardStore(runtime.db, runtime.logger);
  const unknown = (id: string) => ({ error: { message: `unknown dashboard: ${id}` } });
  const created = (res: Response, result: CreateResult | RestoreResult, name: string) => {
    if (result.kind === "id-taken") {
      res.status(409).json({ error: { message: "a dashboard with that id exists again" } });
      return;
    }
    if (result.kind === "full") {
      res.status(409).json({ error: { message: `there can be at most ${MAX_DASHBOARDS} dashboards` } });
      return;
    }
    if (result.kind === "name-taken") {
      res.status(409).json({ error: { message: `a dashboard named "${name}" already exists` } });
      return;
    }
    res.status(201).json(result.dashboard);
  };

  router.get("/dashboards", (_req, res) => {
    res.json(store.list());
  });

  router.post("/dashboards", (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    created(res, store.create(parsed.data.name, parsed.data.layout ?? null), parsed.data.name);
  });

  router.post("/dashboards/import", (req, res) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    created(res, store.import(parsed.data), parsed.data.name);
  });

  router.get("/dashboards/:id", (req, res) => {
    const dashboard = store.get(req.params.id);
    if (dashboard === undefined) {
      res.status(404).json(unknown(req.params.id));
      return;
    }
    res.json(dashboard);
  });

  router.post("/dashboards/restore", (req, res) => {
    const parsed = restoreSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    created(res, store.restore(parsed.data), parsed.data.name);
  });

  router.get("/dashboards/:id/export", (req, res) => {
    const file = store.export(req.params.id);
    if (file === undefined) {
      res.status(404).json(unknown(req.params.id));
      return;
    }
    res.attachment(`isitdown-dashboard-${req.params.id}.json`).json(file);
  });

  router.patch("/dashboards/:id", (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    const result = store.update(req.params.id, parsed.data);
    if (result === undefined) {
      res.status(404).json(unknown(req.params.id));
      return;
    }
    if (result.kind === "name-taken") {
      res.status(409).json({ error: { message: `a dashboard named "${parsed.data.name}" already exists` } });
      return;
    }
    res.json(result.dashboard);
  });

  router.delete("/dashboards/:id", (req, res) => {
    const result = store.remove(req.params.id);
    if (result === undefined) {
      res.status(404).json(unknown(req.params.id));
      return;
    }
    if (result.kind === "last") {
      res.status(409).json({ error: { message: "the last dashboard cannot be deleted" } });
      return;
    }
    // The removed row, for Undo: `POST /dashboards/restore` takes it back as is.
    res.json(result.removed);
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
