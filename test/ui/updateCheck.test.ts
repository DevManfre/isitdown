import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLogger } from "../../src/core/logger.ts";
import {
  checkForUpdate,
  createUpdateChecker,
  CHECK_INTERVAL_MS,
} from "../../src/ui/updateCheck.ts";

const silent = createLogger("error", () => {});

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/ghcr/${name}.json`, import.meta.url), "utf8");

/** A `fetch` that answers the GHCR anonymous-token request, then the tags request, from fixtures. */
function fakeGhcr(tagsFixture: string): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/token")) {
      return new Response(fixture("token"), { status: 200 });
    }
    if (url.includes("/tags/list")) {
      return new Response(fixture(tagsFixture), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

test("a newer ui-v tag on GHCR reports an available update", async () => {
  const state = await checkForUpdate({
    fetch: fakeGhcr("tags-newer-available"),
    currentVersion: "2.5.0",
    logger: silent,
  });
  assert.equal(state.status, "available");
  assert.equal(state.latestVersion, "2.6.0");
  assert.equal(state.currentVersion, "2.5.0");
  assert.notEqual(state.checkedAt, null);
});

test("already on the highest ui-v tag reports no update, not a badge", async () => {
  const state = await checkForUpdate({
    fetch: fakeGhcr("tags-up-to-date"),
    currentVersion: "2.5.0",
    logger: silent,
  });
  assert.equal(state.status, "current");
  assert.equal(state.latestVersion, null);
});

test("non-semver tags like ui-latest and light-v* never count as a newer version", async () => {
  // tags-up-to-date.json carries ui-latest, latest and light-latest beside
  // the real ui-v2.4.0 / ui-v2.5.0 pair — if any of those were mistaken for a
  // real release the status below would not be "current".
  const state = await checkForUpdate({
    fetch: fakeGhcr("tags-up-to-date"),
    currentVersion: "2.5.0",
    logger: silent,
  });
  assert.equal(state.status, "current");
});

test("a network error resolves to the failed status rather than throwing", async () => {
  const throwingFetch = (async () => {
    throw new Error("network unreachable");
  }) as typeof fetch;
  const state = await checkForUpdate({
    fetch: throwingFetch,
    currentVersion: "2.5.0",
    logger: silent,
  });
  assert.equal(state.status, "failed");
  assert.equal(state.latestVersion, null);
});

test("an unexpected (non-2xx, or unparseable) GHCR answer also resolves to failed", async () => {
  const badFetch = (async () => new Response("not json", { status: 200 })) as typeof fetch;
  const state = await checkForUpdate({
    fetch: badFetch,
    currentVersion: "2.5.0",
    logger: silent,
  });
  assert.equal(state.status, "failed");

  const notFoundFetch = (async () => new Response("", { status: 404 })) as typeof fetch;
  const state2 = await checkForUpdate({
    fetch: notFoundFetch,
    currentVersion: "2.5.0",
    logger: silent,
  });
  assert.equal(state2.status, "failed");
});

test("the request never carries the running version, an instance id or a provider count", async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const recordingFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, headers: (init?.headers as Record<string, string>) ?? {} });
    if (url.includes("/token")) return new Response(fixture("token"), { status: 200 });
    return new Response(fixture("tags-up-to-date"), { status: 200 });
  }) as typeof fetch;

  await checkForUpdate({ fetch: recordingFetch, currentVersion: "2.5.0", logger: silent });

  for (const call of seen) {
    assert.ok(!call.url.includes("2.5.0"), `the current version leaked into the URL: ${call.url}`);
    const headerValues = Object.values(call.headers).join(" ");
    assert.ok(!headerValues.includes("2.5.0"), "the current version leaked into a header");
  }
});

test("createUpdateChecker never calls fetch while disabled", async () => {
  const checker = createUpdateChecker({
    logger: silent,
    currentVersion: "2.5.0",
    fetchImpl: (async () => {
      throw new Error("fetch must not be called while the option is off");
    }) as typeof fetch,
  });

  await checker.maybeRun(false);

  assert.equal(checker.state().status, "unknown");
});

test("createUpdateChecker runs once when enabled, then holds off until the interval passes", async () => {
  let tokenRequests = 0;
  const countingFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/token")) {
      tokenRequests += 1;
      return new Response(fixture("token"), { status: 200 });
    }
    return new Response(fixture("tags-up-to-date"), { status: 200 });
  }) as typeof fetch;

  const checker = createUpdateChecker({
    logger: silent,
    currentVersion: "2.5.0",
    fetchImpl: countingFetch,
  });
  const originalNow = Date.now;
  try {
    let now = 1_000_000;
    Date.now = () => now;

    await checker.maybeRun(true);
    assert.equal(checker.state().status, "current");
    assert.equal(tokenRequests, 1);

    // A second run moments later must not fetch again.
    now += 1000;
    await checker.maybeRun(true);
    assert.equal(tokenRequests, 1, "at most one check within the interval");

    // A third run a full day later is allowed to.
    now += CHECK_INTERVAL_MS + 1;
    await checker.maybeRun(true);
    assert.equal(tokenRequests, 2);
  } finally {
    Date.now = originalNow;
  }
});
