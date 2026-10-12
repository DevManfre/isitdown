import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { domainExpiry, IANA_BOOTSTRAP_URL, resetRdapCache } from "../../src/adapters/rdap.ts";

/**
 * Roadmap 2.7: a domain's expiry over RDAP. The fetcher is injected, so the
 * bootstrap and the registry answer are fixtures and the cache can be counted.
 */

const BOOTSTRAP = {
  services: [
    [["com", "net"], ["https://rdap.verisign.com/com/v1/"]],
    [["uk"], ["http://rdap.nominet.uk/uk", "https://rdap.nominet.uk/uk"]],
  ],
};

const DOMAIN = {
  objectClassName: "domain",
  ldhName: "EXAMPLE.COM",
  events: [
    { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" },
    { eventAction: "expiration", eventDate: "2027-08-13T04:00:00Z" },
  ],
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/rdap+json" } });

function fetcher(answers: Record<string, () => Response>): { calls: string[]; fetch: (url: string) => Promise<Response> } {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url: string) => {
      calls.push(url);
      const answer = answers[url];
      if (answer === undefined) throw new Error(`unexpected ${url}`);
      return answer();
    },
  };
}

beforeEach(() => resetRdapCache());

test("the registry IANA names for the TLD answers with the expiration event", async () => {
  const { calls, fetch } = fetcher({
    [IANA_BOOTSTRAP_URL]: () => json(BOOTSTRAP),
    "https://rdap.verisign.com/com/v1/domain/example.com": () => json(DOMAIN),
  });
  assert.deepEqual(await domainExpiry("Example.com", { timeoutMs: 1000, fetcher: fetch }), {
    found: true,
    expiresAt: "2027-08-13T04:00:00.000Z",
  });
  assert.equal(calls.length, 2);
});

test("an https base is preferred, and a missing trailing slash is added", async () => {
  const { fetch } = fetcher({
    [IANA_BOOTSTRAP_URL]: () => json(BOOTSTRAP),
    "https://rdap.nominet.uk/uk/domain/bbc.co.uk": () => json(DOMAIN),
  });
  assert.equal((await domainExpiry("bbc.co.uk", { timeoutMs: 1000, fetcher: fetch })).found, true);
});

test("an answer is kept for hours, a failure for one", async () => {
  let fail = true;
  const { calls, fetch } = fetcher({
    [IANA_BOOTSTRAP_URL]: () => json(BOOTSTRAP),
    "https://rdap.verisign.com/com/v1/domain/example.com": () => (fail ? json({}, 503) : json(DOMAIN)),
  });
  const t0 = Date.parse("2026-10-12T00:00:00Z");
  const first = await domainExpiry("example.com", { timeoutMs: 1000, fetcher: fetch, now: t0 });
  assert.deepEqual(first, { found: false, reason: "rdap.verisign.com answered 503" });
  fail = false;
  assert.equal((await domainExpiry("example.com", { timeoutMs: 1000, fetcher: fetch, now: t0 + 30 * 60_000 })).found, false, "still the remembered failure");
  assert.equal((await domainExpiry("example.com", { timeoutMs: 1000, fetcher: fetch, now: t0 + 61 * 60_000 })).found, true, "asked again after an hour");
  const asked = calls.length;
  await domainExpiry("example.com", { timeoutMs: 1000, fetcher: fetch, now: t0 + 6 * 3600_000 });
  assert.equal(calls.length, asked, "a found answer is not asked for again within hours");
});

test("a TLD without RDAP, a registry without an expiry, an unknown domain: each is said", async () => {
  const { fetch } = fetcher({
    [IANA_BOOTSTRAP_URL]: () => json(BOOTSTRAP),
    "https://rdap.verisign.com/com/v1/domain/noexpiry.com": () => json({ events: [{ eventAction: "registration", eventDate: "2001-01-01T00:00:00Z" }] }),
    "https://rdap.verisign.com/com/v1/domain/missing.com": () => json({}, 404),
  });
  assert.deepEqual(await domainExpiry("google.it", { timeoutMs: 1000, fetcher: fetch }), {
    found: false,
    reason: "the .it registry publishes no RDAP service",
  });
  assert.deepEqual(await domainExpiry("noexpiry.com", { timeoutMs: 1000, fetcher: fetch }), {
    found: false,
    reason: "the .com registry publishes no expiry date",
  });
  assert.deepEqual(await domainExpiry("missing.com", { timeoutMs: 1000, fetcher: fetch }), {
    found: false,
    reason: "the registry does not know this domain",
  });
});
