import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error — a plain .mjs tool, imported for its pure helpers.
import { candidatesFrom, cleanName, linksUnder, slugOf } from "../../tools/build-catalog.mjs";

/**
 * The catalog generator — roadmap 2.1. The network half runs in CI against
 * real pages; these hold the pure half to the rules the generated list relies
 * on, with no request made.
 */

const README = `# Awesome status pages

## Opensource

* [Cachet](https://cachethq.io) - not a status page, a tool for making one

## Public Status Pages

* [GitHub Status API](https://status.github.com/api)
* [Bluesky](http://status.bsky.app) - over http in the list
* not a link at all

## Hosting and Cloud

* [AWS](https://health.aws.amazon.com)
`;

test("only the public status pages section is read, link by link", () => {
  assert.deepEqual(linksUnder(README, "Public Status Pages"), [
    { name: "GitHub Status API", url: "https://status.github.com/api" },
    { name: "Bluesky", url: "http://status.bsky.app" },
  ]);
  assert.deepEqual(linksUnder(README, "Missing"), []);
});

test("the words every status page adds to its name are dropped", () => {
  assert.equal(cleanName("GitHub Status API"), "GitHub");
  assert.equal(cleanName("Pinterest Status Page"), "Pinterest");
  assert.equal(cleanName("WebGazer service status"), "WebGazer");
  assert.equal(cleanName("Status"), "Status", "a name that is only the suffix stays as it was");
  assert.equal(cleanName("Statsig"), "Statsig");
});

test("an id is a slug the service schema accepts", () => {
  assert.equal(slugOf("Monday.com"), "monday-com");
  assert.equal(slugOf("Akamai Linode"), "akamai-linode");
  assert.equal(slugOf("Zürich Café"), "zurich-cafe");
  assert.equal(slugOf("1Password"), "1password");
});

test("the seed wins, one candidate per host, and every url is https", () => {
  const candidates = candidatesFrom(
    [{ id: "github", name: "GitHub", url: "https://www.githubstatus.com", adapter: "statuspage" }],
    [
      { name: "GitHub Status", url: "https://githubstatus.com/" },
      { name: "Bluesky", url: "http://status.bsky.app" },
      { name: "Broken", url: "not a url at all ::" },
    ],
  );
  assert.deepEqual(
    candidates.map((candidate: { id: string; url: string }) => `${candidate.id} ${candidate.url}`),
    ["github https://www.githubstatus.com", "bluesky https://status.bsky.app"],
  );
});

test("two path-addressed pages on one host stay two pages", () => {
  const candidates = candidatesFrom(
    [
      { name: "Uptime.com", url: "https://status.uptime.com/statuspage/a", adapter: "uptimecom" },
      { name: "Other", url: "https://status.uptime.com/statuspage/b", adapter: "uptimecom" },
    ],
    [],
  );
  assert.equal(candidates.length, 2);
});
