import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

async function post(contentType: string, body: string): Promise<{ status: number; body: unknown }> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-bodyparse-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/dashboards`, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
    return { status: response.status, body: (await response.json()) as unknown };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close();
  }
}

// A body the parser refuses is the client's mistake, and the parser says so
// with its own status. Answering 500 told the client the server broke, and
// logged an error for every malformed request anybody sent.
const refused: [string, string, string, number][] = [
  ["malformed JSON", "application/json", "{ not json", 400],
  ["a bare JSON string, which strict parsing refuses", "application/json", '"just a string"', 400],
  ["a bare JSON number", "application/json", "12345", 400],
  ["a JSON body over the 64 kB limit", "application/json", JSON.stringify({ name: "x".repeat(70_000) }), 413],
];

for (const [what, contentType, body, status] of refused) {
  test(`${what} answers ${status} with the error shape, not 500`, async () => {
    const response = await post(contentType, body);
    assert.equal(response.status, status);
    const error = (response.body as { error?: { message?: unknown } }).error;
    assert.equal(typeof error?.message, "string");
  });
}
