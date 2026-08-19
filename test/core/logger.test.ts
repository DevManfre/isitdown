import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../../src/core/logger.ts";

function capture(fn: (write: (line: string) => void) => void): string[] {
  const lines: string[] = [];
  fn((line) => lines.push(line));
  return lines;
}

test("a logger at info level drops debug and keeps info and above", () => {
  const lines = capture((write) => {
    const log = createLogger("info", write);
    log.debug("skipped");
    log.info("kept");
    log.warn("kept too");
    log.error("kept as well");
  });
  assert.equal(lines.length, 3);
  assert.deepEqual(
    lines.map((l) => JSON.parse(l).level),
    ["info", "warn", "error"],
  );
});

test("a logger at debug level keeps everything", () => {
  const lines = capture((write) => {
    const log = createLogger("debug", write);
    log.debug("kept");
    log.error("kept");
  });
  assert.equal(lines.length, 2);
});

test("each line is one JSON object carrying the message, level and fields", () => {
  const [line] = capture((write) => {
    createLogger("info", write).info("cycle finished", { providerId: "github", changes: 2 });
  });
  const parsed = JSON.parse(line ?? "{}");
  assert.equal(parsed.level, "info");
  assert.equal(parsed.msg, "cycle finished");
  assert.equal(parsed.providerId, "github");
  assert.equal(parsed.changes, 2);
  assert.ok(!Number.isNaN(Date.parse(parsed.time)));
});
