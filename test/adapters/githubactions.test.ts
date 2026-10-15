import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { githubActionsAdapter, parseGithubActionsStatus, runsUrl } from "../../src/adapters/githubactions.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = { id: "ci", name: "CI", baseUrl: "https://github.com/owner/repo" };
const fixture = readFileSync(new URL("../fixtures/githubactions/runs.json", import.meta.url), "utf8");
const runWith = (conclusion: string | null): string => JSON.stringify({ workflow_runs: [{ id: 1, conclusion }] });

// apiBase points the adapter at the fake; the path is what GitHub's own API uses.
runAdapterContract("githubactions", () => ({
  adapter: githubActionsAdapter,
  service: (baseUrl) => ({ ...service, options: { apiBase: baseUrl } }),
  ok: { "/repos/owner/repo/actions/runs?status=completed&per_page=1": fixture },
  degraded: { "/repos/owner/repo/actions/runs?status=completed&per_page=1": JSON.stringify({ workflow_runs: [{ id: 1 }] }) },
}));

test("conclusions map: success operational, failure major, needs-attention degraded, cancelled abstains", () => {
  const read = (c: string | null) => parseGithubActionsStatus(runWith(c), service).overallStatus;
  assert.equal(read("success"), "operational");
  assert.equal(read("failure"), "major_outage");
  assert.equal(read("timed_out"), "major_outage");
  assert.equal(read("action_required"), "degraded");
  assert.equal(read("cancelled"), "unknown");
  assert.equal(read(null), "unknown");
  assert.equal(read("something_new"), "major_outage");
});

test("a failed run is one incident naming the run; a green one has none", () => {
  const failed = parseGithubActionsStatus(fixture, service);
  assert.deepEqual(failed.activeIncidents.map((i) => [i.id, i.name, i.createdAt]), [
    ["123456", "CI: Fix the poller", "2026-10-01T09:00:00Z"],
  ]);
  assert.deepEqual(parseGithubActionsStatus(runWith("success"), service).activeIncidents, []);
});

test("a repository with no completed run yet reads unknown, not operational", () => {
  assert.equal(parseGithubActionsStatus(JSON.stringify({ workflow_runs: [] }), service).overallStatus, "unknown");
});

test("the url asks for the newest completed run, narrowed by workflow and branch", () => {
  assert.equal(runsUrl(service), "https://api.github.com/repos/owner/repo/actions/runs?status=completed&per_page=1");
  assert.equal(
    runsUrl({ ...service, options: { workflow: "ci.yml", branch: "main" } }),
    "https://api.github.com/repos/owner/repo/actions/workflows/ci.yml/runs?status=completed&per_page=1&branch=main",
  );
  assert.throws(() => runsUrl({ ...service, baseUrl: "https://github.com/owner" }), /must be a repository/);
});
