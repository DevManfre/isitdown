import { test } from "node:test";
import assert from "node:assert/strict";
import { ArgsError, DEFAULT_INTERVAL_SECONDS, DEFAULT_URL, parseWatchArgs } from "../../src/cli/watch/args.ts";

test("defaults: no args, no env", () => {
  const args = parseWatchArgs([], {});
  assert.equal(args.url, DEFAULT_URL);
  assert.equal(args.token, "");
  assert.equal(args.intervalMs, DEFAULT_INTERVAL_SECONDS * 1000);
});

test("--url, --token and --interval override the defaults", () => {
  const args = parseWatchArgs(["--url", "http://fleet:4000", "--token", "abc", "--interval", "5"], {});
  assert.equal(args.url, "http://fleet:4000");
  assert.equal(args.token, "abc");
  assert.equal(args.intervalMs, 5000);
});

test("API_TOKEN from the environment is used when --token is absent", () => {
  const args = parseWatchArgs([], { API_TOKEN: "env-token" });
  assert.equal(args.token, "env-token");
});

test("--token overrides API_TOKEN", () => {
  const args = parseWatchArgs(["--token", "flag-token"], { API_TOKEN: "env-token" });
  assert.equal(args.token, "flag-token");
});

test("an unknown option is rejected", () => {
  assert.throws(() => parseWatchArgs(["--bogus"], {}), (error: unknown) => {
    assert.ok(error instanceof ArgsError);
    assert.equal(error.key, "cli.error.unknownOption");
    assert.equal(error.params["option"], "--bogus");
    return true;
  });
});

test("an option missing its value is rejected", () => {
  assert.throws(() => parseWatchArgs(["--url"], {}), (error: unknown) => {
    assert.ok(error instanceof ArgsError);
    assert.equal(error.key, "cli.error.missingValue");
    return true;
  });
});

test("a malformed --url is rejected", () => {
  assert.throws(() => parseWatchArgs(["--url", "not a url"], {}), (error: unknown) => {
    assert.ok(error instanceof ArgsError);
    assert.equal(error.key, "cli.error.invalidUrl");
    return true;
  });
});

test("a zero or negative --interval is rejected", () => {
  for (const value of ["0", "-5", "abc"]) {
    assert.throws(() => parseWatchArgs(["--interval", value], {}), (error: unknown) => {
      assert.ok(error instanceof ArgsError);
      assert.equal(error.key, "cli.error.invalidInterval");
      return true;
    });
  }
});
