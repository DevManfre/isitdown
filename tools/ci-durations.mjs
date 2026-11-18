#!/usr/bin/env node
// CI's time budget (roadmap 13.6): how long every job of this run took, as a
// table in the run's summary, with a warning annotation on any job over its
// ceiling. A warning and not a failure: a slow runner is not a broken commit,
// but a job that creeps past its ceiling run after run is a cost somebody
// should decide to pay rather than discover.
//
// Run by `verify`, the last job, which `needs` all the others — so their
// timings are final when it asks. It reads them from the GitHub API rather
// than having every job time itself, so a job added to ci.yml is measured with
// no change here, and shows up as having no ceiling until it is given one.
//
// CLI (in Actions): node tools/ci-durations.mjs — needs GH_TOKEN with actions: read.
import { appendFileSync } from "node:fs";

/**
 * Ceilings in seconds, each about 1.5× the slowest of six green runs measured
 * on 2026-11-17 (in brackets), so ordinary runner noise stays under and a real
 * jump does not. Raise one in the commit that makes the job slower, saying why.
 *
 * The build job's ceiling already counts the component catalog's visual pass
 * (roadmap 13.9), which landed with this table: ~212s before it, ~2.5 minutes
 * more for 92 story frames.
 */
export const CEILINGS = [
  { match: /^Typecheck, lint, README parity$/, seconds: 75 }, // [46s]
  { match: /^Server tests /, seconds: 200 }, // [131s]
  { match: /^Dashboard tests \(Vitest, shard \d+\/\d+\)$/, seconds: 120 }, // [75s]
  { match: /^Dashboard coverage floor/, seconds: 45 }, // [27s]
  { match: /^Build, bundle budget, visual regression$/, seconds: 540 }, // [212s + ~170s of stories]
];

const format = (seconds) => (seconds >= 60 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`);

/**
 * The summary table and the jobs over their ceiling, from the API's job list.
 * A job still running (this one, `verify`) has no duration yet and is left out.
 */
export function summarize(jobs, ceilings = CEILINGS) {
  const rows = [];
  const over = [];
  for (const job of jobs) {
    if (job.started_at == null || job.completed_at == null) continue;
    const seconds = Math.round((Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000);
    const ceiling = ceilings.find((entry) => entry.match.test(job.name))?.seconds;
    const verdict = ceiling === undefined ? "no ceiling set" : seconds > ceiling ? "**over**" : "ok";
    if (ceiling !== undefined && seconds > ceiling) over.push({ name: job.name, seconds, ceiling });
    rows.push(`| ${job.name} | ${format(seconds)} | ${ceiling === undefined ? "—" : format(ceiling)} | ${verdict} |`);
  }
  const markdown = ["### CI time budget", "", "| Job | Took | Ceiling | |", "|---|---|---|---|", ...rows].join("\n");
  return { markdown, over };
}

if (process.argv[1]?.endsWith("ci-durations.mjs")) {
  const { GITHUB_API_URL = "https://api.github.com", GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT = "1", GH_TOKEN, GITHUB_STEP_SUMMARY } = process.env;
  if (!GITHUB_REPOSITORY || !GITHUB_RUN_ID || !GH_TOKEN) {
    process.stderr.write("ci-durations runs inside GitHub Actions: GITHUB_REPOSITORY, GITHUB_RUN_ID and GH_TOKEN are required\n");
    process.exit(1);
  }
  const response = await fetch(
    `${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT}/jobs?per_page=100`,
    { headers: { authorization: `Bearer ${GH_TOKEN}`, accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) {
    // Never the reason a run goes red: the budget is a report, not a gate.
    process.stdout.write(`::warning title=CI time budget::could not read this run's jobs (HTTP ${response.status})\n`);
    process.exit(0);
  }
  const { jobs } = await response.json();
  const { markdown, over } = summarize(jobs);
  process.stdout.write(`${markdown}\n`);
  if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, `${markdown}\n`);
  for (const job of over) {
    process.stdout.write(`::warning title=CI time budget::${job.name} took ${format(job.seconds)}, over its ${format(job.ceiling)} ceiling (tools/ci-durations.mjs)\n`);
  }
}
