import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMetricsRegistry } from "../../src/ui/metrics.ts";
import type { ServiceDefinition } from "../../src/core/configSource.interface.ts";
import type { StateStore } from "../../src/core/stateStore.interface.ts";

/**
 * The committed Grafana dashboard (roadmap 4.14) is only useful while its
 * queries name metrics `/metrics` actually exports. So it is checked against
 * the registry itself rather than against a list written down twice: a renamed
 * metric fails here, in the same run that renames it.
 */

const service: ServiceDefinition = {
  id: "github",
  name: "GitHub",
  adapter: "statuspage",
  baseUrl: "https://www.githubstatus.com",
  enabled: true,
};

/** Just the one method the registry reads, so this suite needs no database. */
const store = {
  getState: async () => ({
    last: {
      provider: "github",
      overallStatus: "operational" as const,
      activeIncidents: [],
      components: [],
      maintenances: [],
      fetchedAt: "2026-09-10T12:00:00.000Z",
    },
    failureCount: 0,
  }),
} as unknown as StateStore;

async function exportedMetricNames(): Promise<Set<string>> {
  const metrics = createMetricsRegistry({ store, listEnabledServices: () => [service] });
  metrics.recordCycle({
    changes: [],
    results: [{ providerId: "github", ok: true, attempts: 1, durationMs: 120 }],
    startedAt: "2026-09-10T11:59:00.000Z",
    finishedAt: "2026-09-10T12:00:00.000Z",
  });
  metrics.recordSent({
    provider: "github",
    channel: "telegram",
    kind: "status_change",
    ok: true,
    at: "2026-09-10T12:00:00.000Z",
    attempts: 1,
  });

  const rendered = await metrics.render();
  return new Set(
    rendered
      .split("\n")
      .filter((line) => line.startsWith("# TYPE "))
      .map((line) => line.split(" ")[2] ?? ""),
  );
}

interface Dashboard {
  uid: string;
  title: string;
  templating: { list: { name: string; type: string }[] };
  panels: {
    type: string;
    title: string;
    targets?: { expr: string; datasource?: { uid?: string } }[];
  }[];
}

const dashboard = async (): Promise<Dashboard> =>
  JSON.parse(await readFile(new URL("../../docs/grafana/isitdown.json", import.meta.url), "utf8")) as Dashboard;

/** Every `isitdown_*` identifier a panel query mentions. */
function metricsQueried(board: Dashboard): string[] {
  const expressions = board.panels.flatMap((panel) => (panel.targets ?? []).map((target) => target.expr));
  return [...new Set(expressions.flatMap((expr) => expr.match(/isitdown_[a-z_]+/g) ?? []))];
}

test("the dashboard is valid JSON with a stable uid and a datasource variable", async () => {
  const board = await dashboard();

  assert.equal(board.uid, "isitdown");
  // A datasource variable rather than a hardcoded uid: the dashboard has to
  // import against whichever Prometheus the operator already has.
  const variable = board.templating.list.find((entry) => entry.name === "datasource");
  assert.equal(variable?.type, "datasource");
});

test("every metric the dashboard queries is one /metrics exports", async () => {
  const [board, exported] = await Promise.all([dashboard(), exportedMetricNames()]);

  const queried = metricsQueried(board);
  assert.ok(queried.length > 0, "a dashboard that queries nothing is not a dashboard");
  for (const metric of queried) {
    assert.ok(exported.has(metric), `${metric} is queried by the dashboard but not exported by /metrics`);
  }
});

test("the dashboard covers what the roadmap asked for: fleet status, polling and notifications", async () => {
  const board = await dashboard();
  const queried = metricsQueried(board);

  assert.ok(queried.includes("isitdown_provider_status"), "fleet status");
  assert.ok(queried.includes("isitdown_poll_duration_seconds"), "polling");
  assert.ok(queried.includes("isitdown_notifications_total"), "notification rate");
  // The one series that is about IsItDown rather than a provider: without it a
  // frozen dashboard looks like a calm fleet.
  assert.ok(queried.includes("isitdown_last_cycle_timestamp_seconds"), "our own staleness");
});

test("every panel query goes through the datasource variable", async () => {
  const board = await dashboard();

  for (const panel of board.panels) {
    for (const target of panel.targets ?? []) {
      assert.equal(
        target.datasource?.uid,
        "${datasource}",
        `panel "${panel.title}" pins a datasource instead of using the variable`,
      );
    }
  }
});
