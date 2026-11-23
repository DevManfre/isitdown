import { z } from "zod";
import { USER_AGENT } from "./http.ts";
import type { Logger } from "./logger.ts";

/**
 * IsItDown's own dead-man's switch — roadmap 10.5.
 *
 * Nothing inside a process can notice the process is gone: a container that
 * died at 3am is found when a provider goes down and the message never comes.
 * So it is noticed from outside. After every cycle that worked, IsItDown calls
 * a URL — Healthchecks.io, an Uptime Kuma push monitor, Cronitor, anything that
 * alerts when the calls stop — and the silence that follows a crash is that
 * service's alert.
 *
 * The opposite direction of the passive monitors in `heartbeat.ts`, which are
 * pinged *by* other jobs; the two share a word and nothing else.
 *
 * A ping is a courtesy to the operator, never a dependency of the cycle: it is
 * not awaited by it, has a short timeout of its own, and a failure lands in the
 * log and nowhere else.
 */

export interface HeartbeatTarget {
  /** Called after every cycle that completed. */
  url?: string | undefined;
  /** Called after a cycle that threw — the `/fail` convention of Healthchecks.io. */
  failUrl?: string | undefined;
  /** GET by default; POST sends a one-line text body (what an ntfy topic needs). */
  method: "GET" | "POST";
}

/** Short on purpose: a ping that has not answered in this long is a failed ping. */
export const HEARTBEAT_TIMEOUT_MS = 5_000;

const httpUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "must be an http or https URL");

/** The shape both editions accept — `config.yml`'s `heartbeat:` and the env variables. */
export const heartbeatTargetSchema = z
  .object({
    url: httpUrl.optional(),
    failUrl: httpUrl.optional(),
    method: z.preprocess(
      (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
      z.enum(["GET", "POST"]).default("GET"),
    ),
  })
  .strict()
  .refine((target) => target.url !== undefined || target.failUrl !== undefined, {
    message: "needs url, failUrl or both",
  });

/**
 * `HEARTBEAT_URL`, `HEARTBEAT_FAIL_URL` and `HEARTBEAT_METHOD`, or undefined
 * when neither URL is set. Throws on a value that cannot work, like every
 * other environment reader here: a heartbeat silently ignored is a dead-man's
 * switch that fires the first night for no reason.
 */
export function readHeartbeatTarget(env: Record<string, string | undefined>): HeartbeatTarget | undefined {
  const blank = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed === "" ? undefined : trimmed;
  };
  const url = blank(env["HEARTBEAT_URL"]);
  const failUrl = blank(env["HEARTBEAT_FAIL_URL"]);
  if (url === undefined && failUrl === undefined) return undefined;
  const method = blank(env["HEARTBEAT_METHOD"]);
  const parsed = heartbeatTargetSchema.safeParse({
    ...(url === undefined ? {} : { url }),
    ...(failUrl === undefined ? {} : { failUrl }),
    ...(method === undefined ? {} : { method }),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = { url: "HEARTBEAT_URL", failUrl: "HEARTBEAT_FAIL_URL", method: "HEARTBEAT_METHOD" }[
      String(issue?.path[0]) as "url" | "failUrl" | "method"
    ];
    throw new Error(`${field ?? "HEARTBEAT_URL"}: ${issue?.message ?? "invalid"}`);
  }
  return parsed.data;
}

export interface HeartbeatPinger {
  /** A cycle completed; resolves once the ping is answered or given up on. Never rejects. */
  succeeded(target: HeartbeatTarget | undefined, summary: string): Promise<void>;
  /** A cycle threw; same promise. */
  failed(target: HeartbeatTarget | undefined, reason: string): Promise<void>;
}

/**
 * Sends the pings. Remembers whether the last one failed so a heartbeat
 * service that is down for an hour costs one warning and one "reachable
 * again", not a warning every cycle.
 */
export function createHeartbeatPinger(logger: Logger, timeoutMs: number = HEARTBEAT_TIMEOUT_MS): HeartbeatPinger {
  let failing = false;

  async function ping(url: string, method: "GET" | "POST", body: string): Promise<void> {
    const host = new URL(url).host;
    try {
      // Plain `fetch`, like a notification channel: the URL comes from the
      // environment or config.yml, never from the dashboard, so the egress
      // policy (roadmap 9.1) — which exists to stop a dashboard user reading
      // the LAN — has nothing to guard, and an Uptime Kuma on the LAN is the
      // common case. The proxy (roadmap 10.7) applies all the same: it is the
      // process's dispatcher, not a property of a helper.
      const response = await fetch(url, {
        method,
        headers: { "user-agent": USER_AGENT, ...(method === "POST" ? { "content-type": "text/plain" } : {}) },
        ...(method === "POST" ? { body } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.body?.cancel().catch(() => undefined);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (failing) logger.info("heartbeat reachable again", { host });
      failing = false;
    } catch (error) {
      // The host, never the URL: a Healthchecks.io URL *is* its credential.
      const fields = { host, error: error instanceof Error ? error.message : String(error) };
      if (failing) logger.debug("heartbeat ping failed", fields);
      else logger.warn("heartbeat ping failed; the cycle carries on", fields);
      failing = true;
    }
  }

  return {
    async succeeded(target, summary) {
      if (target?.url !== undefined) await ping(target.url, target.method, summary);
    },
    async failed(target, reason) {
      if (target?.failUrl !== undefined) await ping(target.failUrl, target.method, reason);
    },
  };
}
