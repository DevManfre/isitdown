import { Router } from "express";
import { z } from "zod";
import { ACTION_MUTE_MINUTES } from "../../core/chatops/actions.ts";
import { MAX_MUTE_MINUTES } from "../../core/chatops/commands.ts";
import { createChatopsBackend } from "../chatops.ts";
import type { UiRuntimeCore } from "../runtime.ts";

/**
 * What a web push toast's buttons call — roadmap 3.1.
 *
 * The service worker has no bot to ask and no chat to authorise by, so the two
 * actions a notification offers are also plain routes. They are the second door
 * onto the same room the Telegram buttons use: both end in `createChatopsBackend`,
 * so "taken in charge" and "muted until" mean one thing whichever surface said
 * them, and a mute set here is the `mutedUntil` the dashboard's own mute button
 * writes and the diff engine reads — never a filter beside it.
 *
 * Authorisation is the API token's existing rule and nothing more: a request
 * carrying the read-only token cannot `POST`, and one without it has to come from
 * this machine, which is where the dashboard that registered the worker lives.
 */

const muteBody = z
  .object({ minutes: z.number().int().min(1).max(MAX_MUTE_MINUTES).optional() })
  .strict();

/** Who a press from the dashboard's own origin is recorded as. */
const WEB_ACTOR = "web";

export function actionsRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();
  const backend = createChatopsBackend(runtime);

  const exists = (providerId: string): boolean =>
    runtime.listAllServices().some((service) => service.id === providerId);

  router.post("/providers/:id/ack", async (req, res) => {
    const providerId = req.params["id"] ?? "";
    if (!exists(providerId)) {
      res.status(404).json({ error: `no provider called ${providerId}` });
      return;
    }
    res.json(await backend.ack(providerId, WEB_ACTOR));
  });

  router.post("/providers/:id/mute", async (req, res) => {
    const providerId = req.params["id"] ?? "";
    // A press sends no body at all, which `express.json` leaves as `undefined`.
    const parsed = muteBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") });
      return;
    }
    if (!exists(providerId)) {
      res.status(404).json({ error: `no provider called ${providerId}` });
      return;
    }
    const mutedUntil = new Date(
      Date.now() + (parsed.data.minutes ?? ACTION_MUTE_MINUTES) * 60_000,
    ).toISOString();
    await backend.mute(providerId, mutedUntil);
    res.json({ mutedUntil });
  });

  return router;
}
