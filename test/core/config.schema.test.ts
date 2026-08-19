import { test } from "node:test";
import assert from "node:assert/strict";
import { serviceDefinitionSchema, pollingSchema, localeSchema } from "../../src/core/config.schema.ts";

test("service definition accepts a minimal valid entry and defaults enabled to true", () => {
  const parsed = serviceDefinitionSchema.parse({
    id: "github",
    name: "GitHub",
    adapter: "statuspage",
    baseUrl: "https://www.githubstatus.com",
  });
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.baseUrl, "https://www.githubstatus.com");
});

test("service definition strips a trailing slash from baseUrl", () => {
  const parsed = serviceDefinitionSchema.parse({
    id: "github",
    name: "GitHub",
    adapter: "statuspage",
    baseUrl: "https://www.githubstatus.com/",
  });
  assert.equal(parsed.baseUrl, "https://www.githubstatus.com");
});

test("service definition rejects an id that is not a lowercase slug", () => {
  for (const id of ["GitHub", "git hub", "", "-github", "git_hub"]) {
    assert.throws(
      () =>
        serviceDefinitionSchema.parse({
          id,
          name: "GitHub",
          adapter: "statuspage",
          baseUrl: "https://x.example",
        }),
      `expected id ${JSON.stringify(id)} to be rejected`,
    );
  }
});

test("service definition rejects a baseUrl that is not http or https", () => {
  for (const baseUrl of ["ftp://x.example", "not a url", "", "//x.example"]) {
    assert.throws(
      () =>
        serviceDefinitionSchema.parse({
          id: "github",
          name: "GitHub",
          adapter: "statuspage",
          baseUrl,
        }),
      `expected baseUrl ${JSON.stringify(baseUrl)} to be rejected`,
    );
  }
});

test("service definition rejects an empty name", () => {
  assert.throws(() =>
    serviceDefinitionSchema.parse({
      id: "github",
      name: "",
      adapter: "statuspage",
      baseUrl: "https://x.example",
    }),
  );
});

test("service definition keeps adapter options when given", () => {
  const parsed = serviceDefinitionSchema.parse({
    id: "acme",
    name: "Acme",
    adapter: "custom",
    baseUrl: "https://acme.example",
    options: { selector: "#status" },
  });
  assert.deepEqual(parsed.options, { selector: "#status" });
});

test("polling schema fills every default", () => {
  assert.deepEqual(pollingSchema.parse({}), {
    intervalMinutes: 3,
    requestTimeoutSeconds: 8,
    maxRetries: 3,
    failureThreshold: 5,
  });
});

test("polling schema rejects a zero, negative or fractional interval", () => {
  for (const intervalMinutes of [0, -1, 1.5]) {
    assert.throws(() => pollingSchema.parse({ intervalMinutes }), `interval ${intervalMinutes}`);
  }
});

test("polling schema rejects an interval beyond a day", () => {
  assert.throws(() => pollingSchema.parse({ intervalMinutes: 1441 }));
  assert.equal(pollingSchema.parse({ intervalMinutes: 1440 }).intervalMinutes, 1440);
});

test("locale schema defaults to en and rejects a non-tag", () => {
  assert.equal(localeSchema.parse(undefined), "en");
  assert.equal(localeSchema.parse("it"), "it");
  assert.throws(() => localeSchema.parse("EN"));
  assert.throws(() => localeSchema.parse(""));
});
