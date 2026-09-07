import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  url: string;
  post: (path: string) => Promise<number>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-events-api-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;

  return {
    runtime,
    url,
    post: async (path) => (await fetch(`${url}${path}`, { method: "POST" })).status,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

/** One parsed `event:`/`data:` pair off the stream. */
interface StreamEvent {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Reads the stream until `wanted` events have been parsed, then abandons it.
 * A raw text read would hang: the response never ends on its own.
 */
async function readEvents(url: string, wanted: number, controller: AbortController): Promise<StreamEvent[]> {
  const response = await fetch(`${url}/events`, {
    headers: { accept: "text/event-stream" },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  // Buffering in front of a stream is the one thing that breaks it, so the
  // response has to say so to both the browser and any reverse proxy.
  assert.equal(response.headers.get("cache-control"), "no-cache");
  assert.equal(response.headers.get("x-accel-buffering"), "no");

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: StreamEvent[] = [];
  let buffer = "";

  while (events.length < wanted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf("\n\n");
    while (split !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const type = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      if (type !== undefined && data !== undefined) {
        events.push({ type, data: JSON.parse(data) as Record<string, unknown> });
      }
      split = buffer.indexOf("\n\n");
    }
  }
  return events;
}

test("a new stream is greeted with the state a fresh tab needs", async () => {
  const app = await api();
  const controller = new AbortController();
  try {
    const [hello] = await readEvents(app.url, 1, controller);

    assert.equal(hello?.type, "hello");
    // The deadline and the clock it is stamped on, so a tab that connects
    // between cycles can count down without waiting for a first cycle event.
    assert.ok("nextPollAt" in hello!.data);
    assert.ok("serverNow" in hello!.data);
    assert.ok("lastPollAt" in hello!.data);
  } finally {
    controller.abort();
    await app.close();
  }
});

test("a finished cycle reaches every open stream", async () => {
  const app = await api();
  const first = new AbortController();
  const second = new AbortController();
  try {
    const streams = Promise.all([readEvents(app.url, 2, first), readEvents(app.url, 2, second)]);
    // Give both streams their greeting before the cycle they are waiting for.
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(await app.post("/poll"), 200);

    for (const events of await streams) {
      const cycle = events.find((event) => event.type === "cycle");
      assert.ok(cycle, "no cycle event arrived");
      assert.ok(typeof cycle.data["finishedAt"] === "string");
      // Deliberately absent: the scheduler re-arms after the event is
      // published, so any deadline readable here is the one that just expired.
      assert.ok(!("nextPollAt" in cycle.data));
      // What changed, so a client knows whether anything but the countdown
      // needs re-reading.
      assert.ok(Array.isArray(cycle.data["changedProviders"]));
      assert.equal(typeof cycle.data["providers"], "number");
    }
  } finally {
    first.abort();
    second.abort();
    await app.close();
  }
});

test("a closed stream is forgotten instead of written to forever", async () => {
  const app = await api();
  const controller = new AbortController();
  try {
    await readEvents(app.url, 1, controller);
    assert.equal(app.runtime.live.subscriberCount(), 1);

    controller.abort();
    // The close event is what unsubscribes; it lands on the next tick.
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(app.runtime.live.subscriberCount(), 0);
    // And a publish with nobody listening is not an error.
    app.runtime.live.publish({ type: "cycle", data: { finishedAt: new Date().toISOString() } });
  } finally {
    await app.close();
  }
});
