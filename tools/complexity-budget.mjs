#!/usr/bin/env node
// Complexity budget (roadmap 16.5): the bundle budget's mechanism, applied to
// what the inventory (16.1) counts. Each figure below has a ceiling; CI warns
// when the tree goes over one. A warning, not a failure — at least to begin
// with: the point is that growth is seen the moment it lands, not that it is
// forbidden ("remove before you add", 16.6, makes it a choice, not a ban).
//
// The ceilings are today's figures, not today's plus headroom: any addition
// warns, and silencing it means raising the ceiling here, in a commit of its
// own that says why and names the Linear issue that justifies it — the same
// discipline as tools/bundle-budget.mjs. A removal leaves room under its
// ceiling for one later addition; it is not lowered automatically.
//
// CLI: node tools/complexity-budget.mjs  (npm run check:complexity)

import { appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inventory } from "./complexity-inventory.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Ceilings, measured on 2026-11-21 (v2.46.1). Raise one only in its own
 * commit, with a line here: from -> to, what grew, the Linear issue.
 */
export const BUDGET = {
  configKeys: 250,
  envVars: 41,
  subsystems: 9,
  targets: 13,
  adapters: 30,
  channels: 31,
};

const LABELS = {
  configKeys: "config.yml keys",
  envVars: "Environment variables",
  subsystems: "Subsystems",
  targets: "Build and packaging targets",
  adapters: "Adapters",
  channels: "Notification channels",
};

/** One adapter is one `*.adapter.ts`, one channel one `*.notifier.ts` (CLAUDE.md conventions). */
const countFiles = (root, dir, suffix) => readdirSync(join(root, dir)).filter((name) => name.endsWith(suffix)).length;

/** Today's figures for every budgeted measure, from the tree at `root`. */
export async function measure(root = ROOT) {
  const { rows } = await inventory(root);
  const total = rows.at(-1);
  return {
    configKeys: total.configKeys,
    envVars: total.envVars,
    subsystems: rows.length - 1,
    targets: total.targets,
    adapters: countFiles(root, "src/adapters", ".adapter.ts"),
    channels: countFiles(root, "src/notifiers", ".notifier.ts"),
  };
}

/**
 * @param {Record<string, number>} figures
 * @param {Record<string, number>} budget
 * @returns {{ rows: { key: string, label: string, value: number, ceiling: number, over: boolean }[], over: { key: string, label: string, value: number, ceiling: number }[] }}
 */
export function checkBudget(figures, budget = BUDGET) {
  const rows = Object.keys(budget).map((key) => ({
    key,
    label: LABELS[key] ?? key,
    value: figures[key] ?? 0,
    ceiling: budget[key],
    over: (figures[key] ?? 0) > budget[key],
  }));
  return { rows, over: rows.filter((row) => row.over) };
}

/** The job summary: one row per measure, the over ones marked. */
export function render({ rows }) {
  return [
    "### Complexity budget",
    "",
    "| Measure | Today | Ceiling | |",
    "|---|--:|--:|---|",
    ...rows.map((row) => `| ${row.label} | ${row.value} | ${row.ceiling} | ${row.over ? "**over**" : "ok"} |`),
  ].join("\n");
}

if (process.argv[1]?.endsWith("complexity-budget.mjs")) {
  const result = checkBudget(await measure());
  const markdown = render(result);
  process.stdout.write(`${markdown}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  for (const row of result.over) {
    process.stdout.write(
      `::warning title=Complexity budget::${row.label}: ${row.value}, over its ceiling of ${row.ceiling}. Raise it in tools/complexity-budget.mjs in a commit of its own, saying why and naming the Linear issue — or remove something first (roadmap 16.6)\n`,
    );
  }
}
