import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { SOURCE_LOCALE, t } from "../../src/core/i18n/index.ts";
import { createApiClient } from "../../src/cli/watch/client.ts";
import { runWatch } from "../../src/cli/watch/watcher.ts";
import type { WatchState } from "../../src/cli/watch/state.ts";

/**
 * A fake UI edition server — just enough of `/status` and `/events`
 * (`src/ui/routes/status.routes.ts`, `src/ui/routes/events.routes.ts`) for
 * the watch client to talk to, with the routing left to each test so the
 * four required scenarios (first draw, a change over the stream, a dropped
 * stream, a rejected token) can each script exactly the responses they need.
 * Nothing here ever reaches a real provider or a real IsItDown instance.
 */
function fakeServer(handle: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server: Server = createServer(handle);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

const translate = (key: string, params?: Record<string, string | number>): string => t(SOURCE_LOCALE, key, params);

function sseHeaders(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
}

function sseFrame(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function statusBody(overallStatus: string, serverNow = "2026-01-01T00:00:00.000Z") {
  return {
    providers: [{ id: "github", name: "GitHub", enabled: true, overallStatus, fetchedAt: serverNow }],
    serverNow,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("first draw: reads /status, opens /events, renders the fleet", async () => {
  const server = await fakeServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(statusBody("operational")));
      return;
    }
    if (req.url === "/events") {
      sseHeaders(res);
      res.write(sseFrame("hello", { lastPollAt: null, nextPollAt: null, serverNow: "2026-01-01T00:00:00.000Z" }));
      return;
    }
    res.writeHead(404).end();
  });

  const controller = new AbortController();
  const states: WatchState[] = [];
  const client = createApiClient(server.url, "");
  const run = runWatch(server.url, {
    client,
    translate,
    intervalMs: 30,
    onState: (state) => states.push(state),
    signal: controller.signal,
  });

  await waitFor(() => states.some((s) => s.connection === "streaming" && s.providers.length === 1));
  const streaming = states.find((s) => s.connection === "streaming")!;
  assert.equal(streaming.providers[0]?.status, "operational");

  controller.abort();
  await run;
  await server.close();
});

test("a status change arriving over the stream is refetched and queued", async () => {
  let cycleSent = false;
  let statusCalls = 0;
  const server = await fakeServer((req, res) => {
    if (req.url === "/status") {
      statusCalls += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(statusBody(statusCalls === 1 ? "operational" : "major_outage", `t${statusCalls}`)));
      return;
    }
    if (req.url === "/events") {
      sseHeaders(res);
      res.write(sseFrame("hello", { lastPollAt: null, nextPollAt: null, serverNow: "t0" }));
      setTimeout(() => {
        if (!cycleSent) {
          cycleSent = true;
          res.write(
            sseFrame("cycle", {
              startedAt: "t1",
              finishedAt: "t1",
              serverNow: "t1",
              providers: 1,
              failed: 0,
              changedProviders: ["github"],
            }),
          );
        }
      }, 20);
      return;
    }
    res.writeHead(404).end();
  });

  const controller = new AbortController();
  const states: WatchState[] = [];
  const client = createApiClient(server.url, "");
  const run = runWatch(server.url, {
    client,
    translate,
    intervalMs: 30,
    onState: (state) => states.push(state),
    signal: controller.signal,
  });

  await waitFor(() => states.some((s) => s.providers[0]?.status === "major_outage"));
  const changed = states.find((s) => s.providers[0]?.status === "major_outage")!;
  assert.equal(changed.changes.length, 1);
  assert.equal(changed.changes[0]?.status, "major_outage");
  assert.equal(changed.changes[0]?.providerId, "github");

  controller.abort();
  await run;
  await server.close();
});

test("a dropped stream falls back to polling and then reconnects on its own", async () => {
  let eventsConnections = 0;
  const server = await fakeServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(statusBody("operational")));
      return;
    }
    if (req.url === "/events") {
      eventsConnections += 1;
      sseHeaders(res);
      res.write(sseFrame("hello", { lastPollAt: null, nextPollAt: null, serverNow: "t0" }));
      if (eventsConnections === 1) {
        // Simulates a connection that dies mid-stream, the case the fallback exists for.
        setTimeout(() => res.destroy(), 15);
      }
      // The second connection is left open: reconnecting is the thing under test.
      return;
    }
    res.writeHead(404).end();
  });

  const controller = new AbortController();
  const states: WatchState[] = [];
  const client = createApiClient(server.url, "");
  const run = runWatch(server.url, {
    client,
    translate,
    intervalMs: 30,
    onState: (state) => states.push(state),
    signal: controller.signal,
  });

  await waitFor(() => states.some((s) => s.connection === "polling"));
  const polling = states.find((s) => s.connection === "polling")!;
  assert.match(polling.errorMessage ?? "", /polling/);

  await waitFor(() => eventsConnections >= 2);
  await waitFor(() => states.some((s, i) => s.connection === "streaming" && i > states.findIndex((x) => x.connection === "polling")));

  controller.abort();
  await run;
  await server.close();
});

test("a rejected token surfaces as a visible error instead of a crash", async () => {
  const server = await fakeServer((req, res) => {
    if (req.url === "/status") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "nope" } }));
      return;
    }
    res.writeHead(404).end();
  });

  const controller = new AbortController();
  const states: WatchState[] = [];
  const client = createApiClient(server.url, "wrong-token");

  await runWatch(server.url, {
    client,
    translate,
    intervalMs: 30,
    onState: (state) => states.push(state),
    signal: controller.signal,
  });

  const last = states.at(-1)!;
  assert.equal(last.connection, "error");
  assert.match(last.errorMessage ?? "", /401/);

  await server.close();
});
