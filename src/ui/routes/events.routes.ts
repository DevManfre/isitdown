import { Router } from "express";
import type { UiRuntimeCore } from "../runtime.ts";

/**
 * How often a comment is written down an idle stream. Nothing reads it: it
 * exists because reverse proxies and load balancers close a connection that
 * has been silent for a minute, and an interval longer than a poll cycle would
 * only ever be silent between cycles anyway.
 */
const HEARTBEAT_MS = 20_000;

/** One server-sent-events frame. */
const frame = (type: string, data: unknown): string => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * The push half of the dashboard's freshness (roadmap 4.2). One long-lived
 * response per open tab; the client re-reads what the event says changed
 * instead of asking on a timer.
 *
 * The stream is a courier, not a source of truth: an event carries what
 * changed and when the next cycle is due, never the provider payloads
 * themselves. A dashboard that rendered from pushed state would have two
 * copies of the fleet to keep in step, and a reconnect would have to reconcile
 * them; re-reading `/status` cannot drift.
 */
export function eventsRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  router.get("/events", (req, res) => {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      // nginx buffers a proxied response by default, which holds every event
      // until the buffer fills — the stream then arrives in bursts, or not at
      // all. This is the header that turns it off.
      "x-accel-buffering": "no",
    });

    // What a tab that connects between cycles needs to draw its countdown,
    // without waiting for a cycle to tell it.
    res.write(
      frame("hello", {
        lastPollAt: runtime.lastCycleAt(),
        nextPollAt: runtime.scheduler.nextRunAt(),
        serverNow: new Date().toISOString(),
      }),
    );

    const unsubscribe = runtime.live.subscribe((event) => {
      res.write(frame(event.type, event.data));
    });

    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, HEARTBEAT_MS);
    // The Light edition's timer is referenced on purpose; this one must not be.
    // A stream held open by an operator's browser is not a reason to keep the
    // process alive.
    heartbeat.unref();

    // `close` covers every way a stream ends — the tab navigating away, the
    // browser reconnecting, a proxy dropping it — and a listener left
    // subscribed writes to a dead socket on every cycle for the rest of the
    // process's life.
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  });

  return router;
}
