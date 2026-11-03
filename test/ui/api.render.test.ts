import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { buildUiRuntime } from "../../src/ui/runtime.ts";
import { clampSide, plan, renderFleetPng } from "../../src/ui/fleetImage.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

async function api() {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-render-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  const server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    get: (path: string) => fetch(`http://127.0.0.1:${port}${path}`),
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

/** Decode our own 1-bit PNG back to rows of ink, to assert on what is drawn. */
function decode(png: Buffer): { width: number; height: number; ink: boolean[][] } {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(png[24], 1, "1-bit");
  assert.equal(png[25], 0, "greyscale");
  const idatLength = png.readUInt32BE(33);
  const raw = inflateSync(png.subarray(41, 41 + idatLength));
  const stride = Math.ceil(width / 8) + 1;
  const ink = Array.from({ length: height }, (_row, y) =>
    Array.from({ length: width }, (_cell, x) => (((raw[y * stride + 1 + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1) === 0),
  );
  return { width, height, ink };
}

test("the fleet PNG is a 1-bit picture of the requested size with ink on it", async () => {
  const app = await api();
  try {
    const response = await app.get("/render/fleet.png?w=400&h=240");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /image\/png/);
    assert.match(response.headers.get("cache-control") ?? "", /max-age=60/);
    const { width, height, ink } = decode(Buffer.from(await response.arrayBuffer()));
    assert.deepEqual([width, height], [400, 240]);
    assert.ok(ink.flat().some(Boolean), "the title and summary are drawn");
  } finally {
    await app.close();
  }
});

test("the fleet SVG says the same thing as text", async () => {
  const app = await api();
  try {
    const response = await app.get("/render/fleet.svg");
    assert.match(response.headers.get("content-type") ?? "", /image\/svg\+xml/);
    const body = await response.text();
    assert.match(body, /^<svg /);
    // A fresh instance ships three providers nobody has polled yet: unknown, never "OK".
    assert.match(body, /3 OF 3 NOT OK/);
    assert.match(body, />UNKNOWN</);
    assert.doesNotMatch(body, />OK</);
  } finally {
    await app.close();
  }
});

test("sides are clamped and a junk value is the default", () => {
  assert.equal(clampSide("10", 800), 200);
  assert.equal(clampSide("99999", 800), 2000);
  assert.equal(clampSide("abc", 800), 800);
  assert.equal(clampSide(undefined, 800), 800);
  assert.equal(clampSide("500", 800), 500);
});

test("worst rows come first and a fleet too long for the panel loses its healthy tail", () => {
  const rows = [
    ...Array.from({ length: 30 }, (_unused, index) => ({ name: `ok-${String(index).padStart(2, "0")}`, status: "operational" as const })),
    { name: "broken", status: "major_outage" as const },
  ];
  const { lines, more, summary } = plan(rows, 400, 240);
  assert.equal(lines[0]?.left, "broken");
  assert.equal(lines[0]?.alarm, true);
  assert.ok(more > 0);
  assert.equal(lines.length + more, 31);
  assert.equal(summary, "1 OF 31 NOT OK");
});

test("an alarm row is inverted: more ink than the same row healthy", () => {
  const ink = (status: "operational" | "major_outage"): number =>
    decode(renderFleetPng([{ name: "github", status }], 400, 240)).ink.flat().filter(Boolean).length;
  assert.ok(ink("major_outage") > ink("operational"));
});
