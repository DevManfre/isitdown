import { test } from "node:test";
import assert from "node:assert/strict";
import { createReportService, reportPeriod } from "../../src/ui/periodicReport.ts";
import type { ServiceDefinition } from "../../src/core/configSource.interface.ts";

const service = (id: string, over: Partial<ServiceDefinition> = {}): ServiceDefinition => ({
  id,
  name: id,
  adapter: "statuspage",
  baseUrl: `https://${id}.example.com`,
  enabled: true,
  ...over,
});

test("a weekly report covers the last complete Monday-to-Sunday week, whatever day it is asked on", () => {
  // 2026-10-21 is a Wednesday: the week that closed is 12–18 October.
  for (const at of ["2026-10-19T00:00:01Z", "2026-10-21T12:00:00Z", "2026-10-25T23:59:59Z"]) {
    assert.deepEqual(reportPeriod("weekly", new Date(at)), {
      key: "weekly:2026-10-12",
      from: "2026-10-12",
      to: "2026-10-18",
    });
  }
  assert.equal(reportPeriod("weekly", new Date("2026-10-26T00:00:00Z")).from, "2026-10-19");
});

test("a monthly report covers the last calendar month, across a year boundary and in February", () => {
  assert.deepEqual(reportPeriod("monthly", new Date("2027-01-03T08:00:00Z")), {
    key: "monthly:2026-12",
    from: "2026-12-01",
    to: "2026-12-31",
  });
  assert.deepEqual(reportPeriod("monthly", new Date("2028-03-01T00:00:00Z")), {
    key: "monthly:2028-02",
    from: "2028-02-01",
    to: "2028-02-29",
  });
});

test("the key tells the frequencies apart, so switching never matches a stale marker", () => {
  const at = new Date("2026-10-21T12:00:00Z");
  assert.notEqual(reportPeriod("weekly", at).key, reportPeriod("monthly", at).key);
});

const provider = (providerId: string, uptime: number | null, downtimeMinutes = 0) => ({
  providerId,
  uptime,
  measuredDays: uptime === null ? 0 : 7,
  sampleCount: uptime === null ? 0 : 100,
  downtimeMinutes,
  incidentCount: 0,
  worstDay: null,
});

function fakeServices(providers: ReturnType<typeof provider>[]) {
  const asked: { from: string; to: string; only: string[] | undefined }[] = [];
  const history = {
    async getRangeReport(from: string, to: string, _interval: number, only?: string[]) {
      asked.push({ from, to, only });
      return {
        from,
        to,
        fleetUptime: 99.5,
        providers,
        incidents: [{}, {}] as never[],
      };
    },
  };
  const sla = {
    async budgets() {
      return [{ providerId: "github", target: 99.9, spentMinutes: 12, budgetMinutes: 43.2 }];
    },
  };
  return { asked, deps: { history, sla } as never };
}

test("the report names the three weakest measured providers below 100%, worst first", async () => {
  const { deps, asked } = fakeServices([
    provider("a", 100),
    provider("b", 97.5),
    provider("c", 99.1),
    provider("d", 91),
    provider("e", 98),
    provider("never", null),
  ]);
  const change = await createReportService(deps).build(
    ["a", "b", "c", "d", "e", "never"].map((id) => service(id)),
    "weekly",
    3,
    new Date("2026-10-21T12:00:00Z"),
  );

  assert.deepEqual(change?.report?.worst, [
    { providerId: "d", uptime: 91 },
    { providerId: "b", uptime: 97.5 },
    { providerId: "e", uptime: 98 },
  ]);
  assert.equal(change?.report?.incidentCount, 2);
  assert.deepEqual(asked[0]?.only, ["a", "b", "c", "d", "e", "never"]);
  assert.equal(change?.kind, "periodic_report");
});

test("disabled providers are left out of the report", async () => {
  const { deps, asked } = fakeServices([provider("a", 99)]);
  await createReportService(deps).build(
    [service("a"), service("off", { enabled: false })],
    "weekly",
    3,
    new Date("2026-10-21T12:00:00Z"),
  );
  assert.deepEqual(asked[0]?.only, ["a"]);
});

test("with nothing to report on there is no report", async () => {
  const { deps } = fakeServices([]);
  const change = await createReportService(deps).build([], "weekly", 3, new Date("2026-10-21T12:00:00Z"));
  assert.equal(change, null);
});

test("a monthly report spends the ended month's budget as the range measured it", async () => {
  const { deps } = fakeServices([provider("github", 99.8, 90)]);
  const change = await createReportService(deps).build(
    [service("github", { slaTarget: 99.9 })],
    "monthly",
    3,
    new Date("2026-11-02T08:00:00Z"),
  );
  const [line] = change?.report?.sla ?? [];
  assert.equal(line?.spentMinutes, 90);
  // October has 31 days: 44640 minutes at 99.9% leaves 44.64 to spend.
  assert.ok(Math.abs((line?.budgetMinutes ?? 0) - 44.64) < 0.001);
});

test("a weekly report reads the month's budget so far, which is what sla_burn warns about", async () => {
  const { deps } = fakeServices([provider("github", 99.8)]);
  const change = await createReportService(deps).build(
    [service("github", { slaTarget: 99.9 })],
    "weekly",
    3,
    new Date("2026-10-21T12:00:00Z"),
  );
  assert.deepEqual(change?.report?.sla, [
    { providerId: "github", target: 99.9, spentMinutes: 12, budgetMinutes: 43.2 },
  ]);
});
