import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogWriter, readFileLogOptions } from "../../src/core/logFile.ts";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "isitdown-log-"));
}

test("no LOG_FILE means stdout only", () => {
  assert.equal(readFileLogOptions({}), null);
  assert.equal(readFileLogOptions({ LOG_FILE: "" }), null);
});

test("the rotation settings fall back to their defaults and never to zero", () => {
  assert.deepEqual(readFileLogOptions({ LOG_FILE: "/var/log/isitdown.log" }), {
    path: "/var/log/isitdown.log",
    maxBytes: 5 * 1024 * 1024,
    maxFiles: 5,
  });
  assert.deepEqual(readFileLogOptions({ LOG_FILE: "a.log", LOG_MAX_BYTES: "2048", LOG_MAX_FILES: "2" }), {
    path: "a.log",
    maxBytes: 2048,
    maxFiles: 2,
  });
  assert.deepEqual(readFileLogOptions({ LOG_FILE: "a.log", LOG_MAX_BYTES: "0", LOG_MAX_FILES: "-3" }), {
    path: "a.log",
    maxBytes: 5 * 1024 * 1024,
    maxFiles: 5,
  });
});

test("a line reaches both stdout and the file", () => {
  const dir = workspace();
  const path = join(dir, "isitdown.log");
  const out: string[] = [];
  const write = createLogWriter({ path, maxBytes: 1024, maxFiles: 2 }, (line) => out.push(line));

  write('{"msg":"one"}');
  write('{"msg":"two"}');

  assert.deepEqual(out, ['{"msg":"one"}', '{"msg":"two"}']);
  assert.equal(readFileSync(path, "utf8"), '{"msg":"one"}\n{"msg":"two"}\n');
  rmSync(dir, { recursive: true, force: true });
});

test("the directory of the log file is created when it is missing", () => {
  const dir = workspace();
  const path = join(dir, "nested", "deeper", "isitdown.log");
  createLogWriter({ path, maxBytes: 1024, maxFiles: 1 }, () => {})("{}");

  assert.equal(readFileSync(path, "utf8"), "{}\n");
  rmSync(dir, { recursive: true, force: true });
});

test("passing maxBytes rotates the live file and keeps maxFiles generations", () => {
  const dir = workspace();
  const path = join(dir, "isitdown.log");
  const write = createLogWriter({ path, maxBytes: 12, maxFiles: 2 }, () => {});

  write("aaaaaaaaaa"); // 11 bytes with the newline: still fits
  write("bbbbbbbbbb"); // would pass 12: rotates first
  write("cccccccccc");
  write("dddddddddd");

  assert.equal(readFileSync(path, "utf8"), "dddddddddd\n");
  assert.equal(readFileSync(`${path}.1`, "utf8"), "cccccccccc\n");
  assert.equal(readFileSync(`${path}.2`, "utf8"), "bbbbbbbbbb\n");
  // maxFiles is how many rotated generations survive; the oldest is dropped.
  assert.equal(existsSync(`${path}.3`), false);
  rmSync(dir, { recursive: true, force: true });
});

test("a restart keeps appending to a file that is still under the limit", () => {
  const dir = workspace();
  const path = join(dir, "isitdown.log");
  writeFileSync(path, "from the previous run\n");

  createLogWriter({ path, maxBytes: 1024, maxFiles: 1 }, () => {})("after the restart");

  assert.equal(readFileSync(path, "utf8"), "from the previous run\nafter the restart\n");
  rmSync(dir, { recursive: true, force: true });
});

test("an unwritable path is reported once on stdout and never stops the logger", () => {
  const dir = workspace();
  // A directory where the log file is expected is the cheap portable way to
  // make every write fail — a read-only mount is the real-world case.
  const path = join(dir, "isitdown.log");
  writeFileSync(join(dir, "keep"), "");
  const out: string[] = [];
  const write = createLogWriter({ path: dir, maxBytes: 1024, maxFiles: 1 }, (line) => out.push(line));

  write('{"msg":"one"}');
  write('{"msg":"two"}');

  assert.equal(out.length, 3);
  assert.match(out[0] ?? "", /file logging disabled/);
  assert.deepEqual(out.slice(1), ['{"msg":"one"}', '{"msg":"two"}']);
  assert.equal(existsSync(path), false);
  rmSync(dir, { recursive: true, force: true });
});
