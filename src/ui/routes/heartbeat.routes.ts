import { Router, type Request, type Response } from "express";
import type { UiRuntimeCore } from "../runtime.ts";
import { mayWrite } from "../apiToken.ts";
import { HEARTBEAT_ADAPTER_ID } from "../../core/heartbeat.ts";
import { tokenMatches } from "./push.routes.ts";

/**
 * The URL a job calls when it has run — roadmap 2.5, the dead-man's switch.
 *
 * GET as well as POST, because the caller is the last line of a crontab and
 * `curl -fsS <url>` or `wget -qO- <url>` is what fits there. A ping records the
 * time and asks for a read of that one provider right away, so a job that was
 * late and has now called resolves in seconds rather than on the next cadence;
 * the verdict itself is the adapter's, through the diff engine like any other.
 *
 * **Authentication** is the push route's (roadmap 1.2): the caller is a script,
 * not an operator, so the credential is the URL. `HEARTBEAT_TOKEN` unset, the
 * route does not exist; set, it appears as `?token=` and is compared in
 * constant time. Its own variable rather than `PUSH_TOKEN`, since one is pasted
 * into a provider's settings page and the other into crontabs on your own
 * machines, and rotating one should not mean editing both.
 */

/** Stands in for the token in a URL shown to a read-only token holder. */
const TOKEN_PLACEHOLDER = "<HEARTBEAT_TOKEN>";

/** A job retried in a tight loop gets one read per window, not one per call. */
const COOLDOWN_MS = 10_000;

export function heartbeatRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();
  const ledger = runtime.heartbeats;
  const lastRead = new Map<string, number>();

  /**
   * What the dashboard needs to hand a job its URL: whether the feature is on,
   * every heartbeat provider's URL, and when it last called — the only proof
   * a crontab line is right. The token is revealed only to a request that
   * could also write, as for the push URL.
   */
  router.get("/config/heartbeats", (req, res) => {
    const token = (runtime.env["HEARTBEAT_TOKEN"] ?? "").trim();
    const enabled = token !== "";
    const revealed = enabled && mayWrite(runtime.env, req);
    const origin = `${req.protocol}://${req.host}`;
    const records = new Map(ledger.list().map((record) => [record.providerId, record]));
    res.json({
      enabled,
      tokenRevealed: revealed,
      heartbeats: runtime
        .listAllServices()
        .filter((service) => service.adapter === HEARTBEAT_ADAPTER_ID)
        .map((service) => {
          const record = records.get(service.id);
          return {
            providerId: service.id,
            url:
              enabled && service.enabled
                ? `${origin}/heartbeat/${encodeURIComponent(service.id)}?token=${revealed ? encodeURIComponent(token) : TOKEN_PLACEHOLDER}`
                : null,
            lastPingAt: record?.lastPingAt ?? null,
            pings: record?.pings ?? 0,
          };
        }),
    });
  });

  const ping = async (req: Request, res: Response): Promise<void> => {
    const token = (runtime.env["HEARTBEAT_TOKEN"] ?? "").trim();
    if (token === "") {
      // 404 rather than 403: an instance that has not opted in should not
      // advertise that the feature exists.
      res.status(404).json({ error: { message: "not found" } });
      return;
    }
    const given = typeof req.query["token"] === "string" ? req.query["token"] : "";
    if (!tokenMatches(token, given)) {
      runtime.logger.warn("a heartbeat arrived with the wrong token", { providerId: req.params["providerId"] });
      res.status(401).json({ error: { message: "bad token" } });
      return;
    }
    const providerId = req.params["providerId"] ?? "";
    const service = runtime.listAllServices().find((entry) => entry.id === providerId);
    if (service === undefined || !service.enabled || service.adapter !== HEARTBEAT_ADAPTER_ID) {
      res.status(404).json({ error: { message: `unknown heartbeat: ${providerId}` } });
      return;
    }

    const now = Date.now();
    ledger.record(service.id, new Date(now).toISOString());
    if (now - (lastRead.get(service.id) ?? 0) < COOLDOWN_MS) {
      res.status(202).json({ status: "recorded", providerId: service.id });
      return;
    }
    lastRead.set(service.id, now);
    const result = await runtime.scheduler.triggerFor(service.id);
    res.json({ status: "polled", providerId: service.id, changes: result.changes.length });
  };

  router.get("/heartbeat/:providerId", ping);
  router.post("/heartbeat/:providerId", ping);

  return router;
}
