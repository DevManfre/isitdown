import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { statuspageAdapter } from "../../src/adapters/statuspage.adapter.ts";
import { runAdapterContract } from "./adapter.contract.ts";

// incident.io publishes its pages in Atlassian Statuspage's own format at
// `/api/v2/summary.json` (roadmap 2.12), so the `statuspage` adapter reads them;
// this pins that with a document recorded from status.incident.io.
const fixture = readFileSync(new URL("../fixtures/incidentio/summary.json", import.meta.url), "utf8");
const incidents = readFileSync(new URL("../fixtures/incidentio/incidents.json", import.meta.url), "utf8");
const service = { id: "incidentio", name: "incident.io", baseUrl: "https://status.incident.io" };

runAdapterContract("incident.io page through statuspage", () => ({
  adapter: statuspageAdapter,
  service: (baseUrl) => ({ ...service, baseUrl }),
  ok: { "/api/v2/summary.json": fixture, "/api/v2/incidents.json": incidents },
  degraded: {
    "/api/v2/summary.json": JSON.stringify({ status: { indicator: "none" } }),
    "/api/v2/incidents.json": JSON.stringify({ incidents: [] }),
  },
}));

test("a recorded incident.io page reads operational", async () => {
  const { withServer } = await import("../helpers/localServer.ts");
  await withServer(
    (_req, res) => res.end(fixture),
    async (url) => {
      const read = await statuspageAdapter.fetchStatus({ ...service, baseUrl: url }, { timeoutMs: 2000 });
      assert.equal(read.overallStatus, "operational");
    },
  );
});
