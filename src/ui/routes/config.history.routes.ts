import type { Router } from "express";
import { z } from "zod";
import { listAudit, readAuditEntry, revertEntry } from "../configAudit.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { issues } from "./config.shared.ts";

const querySchema = z.object({
  kind: z.enum(["service", "setting", "channel", "routing", "recipients", "credential"]).optional(),
  target: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/**
 * Configuration history — roadmap 5.7. The trail itself is written by the
 * `auditWrites` middleware; these two routes read it and put one value back.
 */
export function configHistoryRoutes(runtime: UiRuntimeCore, router: Router): void {
  const db = runtime.db;

  /** Newest first: `{ entries: [{ id, at, actor, kind, target, field, before, after, revertible, … }] }`. */
  router.get("/config/history", (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    res.json({ entries: listAudit(db, parsed.data) });
  });

  /**
   * Writes an entry's old value back. An ordinary write, so the revert lands in
   * the trail like any other. 409 when the old value can no longer be written.
   */
  router.post("/config/history/:id/revert", (req, res) => {
    const id = Number(req.params["id"]);
    const entry = Number.isInteger(id) && id > 0 ? readAuditEntry(db, id) : undefined;
    if (entry === undefined) {
      res.status(404).json({ error: { message: "no such history entry" } });
      return;
    }
    try {
      revertEntry(db, entry);
    } catch (error) {
      res.status(409).json({ error: { message: error instanceof Error ? error.message : String(error) } });
      return;
    }
    res.json({ reverted: entry });
  });
}
