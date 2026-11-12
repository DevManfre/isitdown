import { test } from "node:test";
import assert from "node:assert/strict";
import { countTerms, rankComponents } from "../../src/ui/incidentWords.ts";

const titles = (providerId: string, ...names: string[]) => names.map((name) => ({ providerId, name }));

test("a word counts once per incident, with the providers it came from", () => {
  const { words } = countTerms([
    ...titles("github", "Database latency in Actions", "Database database failover"),
    ...titles("slack", "Degraded database performance"),
  ]);
  assert.deepEqual(words[0], { term: "database", incidents: 3, providers: ["github", "slack"] });
});

test("filler words and the incident boilerplate every title shares are left out", () => {
  const { words } = countTerms(titles("github", "We are investigating issues with the API", "Investigating an issue with the API"));
  assert.deepEqual(
    words.map((word) => word.term),
    ["api"],
  );
});

test("a recurring phrase is kept whole rather than as the pieces it is made of", () => {
  const { phrases } = countTerms(
    titles("github", "Elevated error rates for Pages", "Elevated error rates on API requests", "Elevated latency"),
  );
  assert.deepEqual(phrases, [{ term: "elevated error rates", incidents: 2, providers: ["github"] }]);
});

test("a phrase seen in only one incident is not a pattern", () => {
  const { phrases } = countTerms(titles("github", "DNS resolution failures"));
  assert.deepEqual(phrases, []);
});

test("words in any script survive, numbers alone do not", () => {
  const { words } = countTerms(titles("x", "Störung der Datenbank 503", "Datenbank Wartung 2026"));
  assert.equal(words[0]?.term, "datenbank");
  assert.equal(words.some((word) => /^\d+$/.test(word.term)), false);
});

test("components rank by the days they were not operational, quiet ones left out", () => {
  const ranked = rankComponents([
    {
      providerId: "github",
      components: [
        { componentId: "actions", name: "Actions", buckets: [{ status: "degraded" }, { status: "major_outage" }, { status: "operational" }] },
        { componentId: "pages", name: "Pages", buckets: [{ status: "operational" }, { status: "unknown" }] },
      ],
    },
    {
      providerId: "slack",
      components: [{ componentId: "messaging", name: "Messaging", buckets: [{ status: "partial_outage" }] }],
    },
  ]);
  assert.deepEqual(ranked, [
    { providerId: "github", componentId: "actions", name: "Actions", badDays: 2 },
    { providerId: "slack", componentId: "messaging", name: "Messaging", badDays: 1 },
  ]);
});
