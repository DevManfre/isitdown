import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jsonAdapter } from "../../src/adapters/json.adapter.ts";
import { optionProblems } from "../../src/adapters/index.ts";
import type {
  FetchContext,
  ServiceRef,
} from "../../src/core/adapter.interface.ts";
import { withServer } from "../helpers/localServer.ts";
import { runAdapterContract } from "./adapter.contract.ts";

/**
 * A page in a shape nobody standardised — which is the whole point of roadmap
 * 11.1. Hand-written rather than recorded, because the adapter is not about one
 * provider: what is under test is that a mapping describes an arbitrary
 * document, so the fixture is deliberately *not* shaped like Statuspage.
 */
const fixture = readFileSync(
  new URL("../fixtures/json/summary.json", import.meta.url),
  "utf8",
);

const OPTIONS: Record<string, string> = {
  path: "/api/status",
  statusPath: "service.state",
  statusMap: JSON.stringify({
    UP: "operational",
    DEGRADED: "degraded",
    PARTIAL: "partial_outage",
    DOWN: "major_outage",
  }),
  incidentsPath: "events",
  incidentId: "ref",
  incidentName: "title",
  incidentStatus: "phase",
  incidentImpact: "severity",
  incidentUpdatedAt: "changedAt",
};

const service = (
  baseUrl: string,
  options: Record<string, string> = OPTIONS,
): ServiceRef => ({
  id: "acme",
  name: "Acme Cloud",
  baseUrl,
  options,
});

const ctx: FetchContext = { timeoutMs: 2000 };

const serving =
  (body: string) =>
  (
    _req: unknown,
    res: {
      setHeader: (k: string, v: string) => void;
      end: (b: string) => void;
    },
  ) => {
    res.setHeader("content-type", "application/json");
    res.end(body);
  };

runAdapterContract("json", () => ({
  adapter: jsonAdapter,
  service: (baseUrl) => service(baseUrl),
  ok: { "/api/status": fixture },
  // Everything optional stripped: a status word and nothing else, which is a
  // perfectly ordinary page.
  degraded: {
    "/api/status": JSON.stringify({ service: { state: "UP" }, events: [] }),
  },
}));

test("a declared mapping reads an arbitrary document", async () => {
  await withServer(serving(fixture), async (baseUrl) => {
    const status = await jsonAdapter.fetchStatus(service(baseUrl), ctx);
    assert.equal(status.provider, "acme");
    // PARTIAL maps to partial_outage, and the open incidents cannot make it better.
    assert.equal(status.overallStatus, "partial_outage");
    assert.deepEqual(
      status.activeIncidents.map((incident) => [
        incident.id,
        incident.name,
        incident.status,
        incident.impact,
      ]),
      [
        [
          "EV-4411",
          "Elevated error rates in eu-west",
          "investigating",
          "major",
        ],
        ["EV-4412", "Slow uploads", "monitoring", "minor"],
      ],
    );
  });
});

test("a word the table does not cover reads unknown, never a guess", async () => {
  const body = JSON.stringify({ service: { state: "WOBBLY" }, events: [] });
  await withServer(serving(body), async (baseUrl) => {
    const status = await jsonAdapter.fetchStatus(service(baseUrl), ctx);
    // Not "degraded by heuristic": the operator described this provider's
    // vocabulary, and a gap in it is a thing to be told about.
    assert.equal(status.overallStatus, "unknown");
  });
});

test("matching a status word ignores case and surrounding space", async () => {
  const body = JSON.stringify({ service: { state: "  up " }, events: [] });
  await withServer(serving(body), async (baseUrl) => {
    assert.equal(
      (await jsonAdapter.fetchStatus(service(baseUrl), ctx)).overallStatus,
      "operational",
    );
  });
});

test("an open incident cannot leave a page reading operational", async () => {
  const body = JSON.stringify({
    service: { state: "UP" },
    events: [
      { ref: "e1", title: "Something is wrong", phase: "investigating" },
    ],
  });
  await withServer(serving(body), async (baseUrl) => {
    const status = await jsonAdapter.fetchStatus(service(baseUrl), ctx);
    assert.equal(status.overallStatus, "degraded");
    assert.equal(status.activeIncidents.length, 1);
  });
});

test("an entry with no name is dropped rather than put on the timeline blank", async () => {
  const body = JSON.stringify({
    service: { state: "UP" },
    events: [{ ref: "e1" }, { ref: "e2", title: "Real" }],
  });
  await withServer(serving(body), async (baseUrl) => {
    const status = await jsonAdapter.fetchStatus(service(baseUrl), ctx);
    assert.deepEqual(
      status.activeIncidents.map((incident) => incident.name),
      ["Real"],
    );
  });
});

test("an incident with no id of its own is still identifiable across two reads", async () => {
  const body = JSON.stringify({
    service: { state: "UP" },
    events: [{ title: "First" }, { title: "Second" }],
  });
  await withServer(serving(body), async (baseUrl) => {
    const first = await jsonAdapter.fetchStatus(service(baseUrl), ctx);
    const second = await jsonAdapter.fetchStatus(service(baseUrl), ctx);
    assert.deepEqual(
      first.activeIncidents.map((incident) => incident.id),
      second.activeIncidents.map((incident) => incident.id),
      "or every poll would reopen the same incident as a new one",
    );
  });
});

test("a path that resolves to nothing reads unknown rather than throwing", async () => {
  const body = JSON.stringify({ different: { shape: true } });
  await withServer(serving(body), async (baseUrl) => {
    assert.equal(
      (await jsonAdapter.fetchStatus(service(baseUrl), ctx)).overallStatus,
      "unknown",
    );
  });
});

test("array indexes are part of a path", async () => {
  const body = JSON.stringify({
    regions: [{ state: "DOWN" }, { state: "UP" }],
  });
  const options = {
    ...OPTIONS,
    statusPath: "regions[0].state",
    incidentsPath: "",
    incidentName: "",
  };
  delete (options as Record<string, string>)["incidentsPath"];
  delete (options as Record<string, string>)["incidentName"];
  delete (options as Record<string, string>)["incidentId"];
  delete (options as Record<string, string>)["incidentStatus"];
  delete (options as Record<string, string>)["incidentImpact"];
  delete (options as Record<string, string>)["incidentUpdatedAt"];
  await withServer(serving(body), async (baseUrl) => {
    assert.equal(
      (await jsonAdapter.fetchStatus(service(baseUrl, options), ctx))
        .overallStatus,
      "major_outage",
    );
  });
});

test("a body that is not JSON is a failed read, so the poller can retry it", async () => {
  await withServer(serving("<html>nope</html>"), async (baseUrl) => {
    await assert.rejects(
      () => jsonAdapter.fetchStatus(service(baseUrl), ctx),
      /not JSON/,
    );
  });
});

test("a mapping is checked when it is configured, not when it is read", () => {
  // Roadmap 11.1's whole point: this is the moment the operator can fix it.
  assert.deepEqual(optionProblems("json", OPTIONS), []);

  const problems = (options: Record<string, string>): string =>
    optionProblems("json", options).join(" | ");

  assert.match(
    problems({ statusMap: OPTIONS["statusMap"] as string }),
    /statusPath/,
  );
  assert.match(
    problems({ ...OPTIONS, statusPath: "not a path!" }),
    /path like/,
  );
  assert.match(
    problems({ ...OPTIONS, statusMap: "{" }),
    /must be a JSON object/,
  );
  assert.match(
    problems({ ...OPTIONS, statusMap: JSON.stringify({ UP: "fine" }) }),
    /values must each be one of/,
  );
  // An incident list with no name is a timeline of blank rows.
  assert.match(
    problems({
      statusPath: "a.b",
      statusMap: OPTIONS["statusMap"] as string,
      incidentsPath: "events",
    }),
    /needs incidentName/,
  );
  assert.match(
    problems({
      statusPath: "a.b",
      statusMap: OPTIONS["statusMap"] as string,
      incidentName: "title",
    }),
    /means nothing without incidentsPath/,
  );
});

test("an adapter with nothing to validate reports no problems", () => {
  assert.deepEqual(optionProblems("statuspage", { anything: "at all" }), []);
  assert.deepEqual(
    optionProblems("no-such-adapter", {}),
    [],
    "its own error is reported elsewhere",
  );
});
