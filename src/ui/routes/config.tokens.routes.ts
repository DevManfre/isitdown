import type { Router } from "express";
import { z } from "zod";
import { API_SCOPES } from "../dbApiTokens.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { issues } from "./config.shared.ts";

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    scopes: z.array(z.enum(API_SCOPES)).min(1),
  })
  .strict();

/**
 * API tokens — roadmap 9.11. All three need `admin` (see `ROUTE_SCOPES` in
 * `apiToken.ts`), which the dashboard on this machine has by the local bypass.
 *
 * The list never carries a hash, and the token itself appears in exactly one
 * response: the one that created it.
 */
export function configTokenRoutes(runtime: UiRuntimeCore, router: Router): void {
  const tokens = runtime.apiTokens;

  /**
   * `{ tokens: [{ id, name, scopes, createdAt, lastUsedAt, revokedAt }], envToken }`,
   * oldest first. `envToken` says whether `API_TOKEN` is set, so Settings can
   * show it as a row it cannot revoke — never its value.
   */
  router.get("/config/tokens", (_req, res) => {
    res.json({ tokens: tokens.list(), envToken: (runtime.env["API_TOKEN"] ?? "").trim() !== "" });
  });

  /** `201 { id, name, scopes, createdAt, lastUsedAt, revokedAt, token }` — the token, once. */
  router.post("/config/tokens", (req, res) => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    res.status(201).json(tokens.create(parsed.data));
  });

  /** Revokes rather than deletes: the list keeps the name and the last use. 404 for an unknown or already revoked one. */
  router.delete("/config/tokens/:id", (req, res) => {
    const id = Number(req.params["id"]);
    if (!Number.isInteger(id) || id < 1 || !tokens.revoke(id)) {
      res.status(404).json({ error: { message: "no such active token" } });
      return;
    }
    res.status(204).end();
  });
}
