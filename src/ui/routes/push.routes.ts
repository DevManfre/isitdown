import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { UiRuntimeCore } from "../runtime.ts";

/**
 * Provider push instead of poll — roadmap 2.10.
 *
 * Atlassian Statuspage lets a subscriber register a URL and posts to it on
 * every change. The prize is latency: a cadence becomes seconds, and the
 * request budget for a quiet provider becomes almost nothing.
 *
 * **What arrives here is a trigger, not a reading.** That is the whole design
 * decision, and it is the one the roadmap row insisted on — "both paths have to
 * converge on the same diff-engine input". A webhook body could be parsed into
 * a `NormalizedStatus` directly, and then there would be two ways a provider's
 * state can be learned, agreeing only by accident: two parsers to keep in step
 * with Statuspage's payload, two places `unknown` can be produced, two chances
 * for a pushed incident to be shaped differently from a polled one. So a push
 * does exactly one thing — it reads that provider, now, through the adapter
 * that already knows how. The reading, the diff engine, the routing and the
 * dispatcher are then the same objects a scheduled cycle uses.
 *
 * The cost is one HTTP request per event instead of zero, which is still far
 * fewer than one per cadence forever, and the benefit is that there is no
 * second code path to be wrong.
 *
 * **Polling stays.** A push is an extra, never a replacement: the standing
 * schedule keeps running, and this route does not re-arm or delay it. A
 * homelab install with no inbound URL — which the row named as the reason this
 * cannot be the only path — behaves exactly as it does today.
 *
 * **Authentication.** Statuspage sends no signature and no custom headers, so
 * the only credential available is the URL. `PUSH_TOKEN` is that credential:
 * unset, this route does not exist at all; set, it has to appear as `?token=`
 * and is compared in constant time. Treat the URL as the secret it is — and
 * note that this is the one route deliberately reachable without the read-only
 * API token (roadmap 4.15), since the caller is a provider rather than an
 * operator.
 */

/** A provider may trigger at most one read this often, however many events it sends. */
const COOLDOWN_MS = 10_000;

/**
 * What a Statuspage webhook looks like, checked loosely on purpose.
 *
 * Nothing here is *used* — the adapter goes and reads the page — so the schema
 * exists to refuse obvious nonsense (an empty body, a scan, a form post) and
 * to give the log something to say about what arrived. Being strict about a
 * payload we deliberately do not depend on would be the coupling this route
 * exists to avoid.
 */
const bodySchema = z.object({
  page: z.object({ id: z.string().optional(), status_indicator: z.string().optional() }).optional(),
  incident: z.object({ name: z.string().optional(), status: z.string().optional() }).optional(),
  component_update: z.object({ new_status: z.string().optional() }).optional(),
  component: z.object({ name: z.string().optional() }).optional(),
});

function tokenMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function pushRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  /** When each provider last had a push honoured — the coalescing window. */
  const lastPush = new Map<string, number>();

  router.post("/push/:providerId", async (req, res) => {
    const token = (runtime.env["PUSH_TOKEN"] ?? "").trim();
    if (token === "") {
      // 404 rather than 403: an instance that has not opted in should not
      // advertise that the feature exists.
      res.status(404).json({ error: { message: "not found" } });
      return;
    }

    const given = typeof req.query["token"] === "string" ? req.query["token"] : "";
    if (!tokenMatches(token, given)) {
      runtime.logger.warn("a push arrived with the wrong token", { providerId: req.params.providerId });
      res.status(401).json({ error: { message: "bad token" } });
      return;
    }

    const service = runtime.listAllServices().find((entry) => entry.id === req.params.providerId);
    if (service === undefined || !service.enabled) {
      res.status(404).json({ error: { message: `unknown provider: ${req.params.providerId}` } });
      return;
    }

    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { message: "this does not look like a status page webhook" } });
      return;
    }

    const now = Date.now();
    const since = now - (lastPush.get(service.id) ?? 0);
    if (since < COOLDOWN_MS) {
      // Statuspage sends several posts within seconds of one change — the
      // incident, then each component. One read covers all of them, and
      // answering 202 says the event was taken without promising a fetch.
      res.status(202).json({ status: "coalesced", providerId: service.id });
      return;
    }
    lastPush.set(service.id, now);

    runtime.logger.info("a provider pushed a change — reading it now", {
      providerId: service.id,
      incident: parsed.data.incident?.name,
      indicator: parsed.data.page?.status_indicator,
    });

    // Awaited, so the answer says what actually happened: a provider debugging
    // its own webhook deliveries deserves better than an unconditional 202.
    const result = await runtime.scheduler.triggerFor(service.id);
    res.json({
      status: "polled",
      providerId: service.id,
      changes: result.changes.length,
      finishedAt: result.finishedAt,
    });
  });

  return router;
}
