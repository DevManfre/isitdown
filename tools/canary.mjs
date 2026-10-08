// The nightly canary — roadmap 1.9. The test suite never touches a real
// provider, rightly; but an adapter breaks when *someone else* changes their
// JSON, and nothing in the suite can see that happen. This is the one place
// that looks: it reads every page in the bundled catalog through its real
// adapter and compares the shape of what came back with the fixtures the
// adapter's tests are written against.
//
// Run on a schedule by .github/workflows/canary.yml, outside the suite and
// never blocking a build. It always exits 0 unless it crashes itself: a drift
// is a finding to report, not a failed build.
//
// CLI: node tools/canary.mjs [--report <file.md>] [--only <id,id>]
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const TIMEOUT_MS = 15_000;

/** Fixtures that exist to be broken on purpose, never a description of a real page. */
const NOT_A_SHAPE = /malformed|broken|invalid/;

/**
 * Every path a JSON value has, and the kinds of value seen at each.
 *
 * Arrays fold their elements into one `[]` segment, so a list of fifty
 * incidents and a list of two have the same shape; `null` is recorded like any
 * other kind, and treated as a wildcard when comparing.
 *
 * @param {unknown} value
 * @returns {Map<string, Set<string>>}
 */
export function shapeOf(value) {
  /** @type {Map<string, Set<string>>} */
  const shape = new Map();
  const walk = (node, path) => {
    const kind = node === null ? "null" : Array.isArray(node) ? "array" : typeof node;
    const kinds = shape.get(path) ?? new Set();
    kinds.add(kind);
    shape.set(path, kinds);
    if (Array.isArray(node)) for (const item of node) walk(item, `${path}[]`);
    else if (kind === "object") for (const [key, child] of Object.entries(node)) walk(child, `${path}.${key}`);
  };
  walk(value, "$");
  return shape;
}

const parentOf = (path) => {
  if (path.endsWith("[]")) return path.slice(0, -2);
  const dot = path.lastIndexOf(".");
  return dot === -1 ? null : path.slice(0, dot);
};

const solid = (kinds) => new Set([...kinds].filter((kind) => kind !== "null"));

/**
 * Where a live answer departs from a fixture's shape.
 *
 * Only what would break a parser counts: a field the fixture has that the live
 * answer has lost, or a field whose kind changed. A field the provider added is
 * not drift — an adapter ignores what it does not read. A path is only called
 * missing when the object that should hold it is there and does not: an empty
 * list today says nothing about the shape of its elements, so nothing under it
 * is judged.
 *
 * @param {Map<string, Set<string>>} fixture
 * @param {Map<string, Set<string>>} live
 * @returns {{ path: string, problem: "missing" | "changed", expected: string, got?: string }[]}
 */
export function driftBetween(fixture, live) {
  const drift = [];
  for (const [path, expectedKinds] of fixture) {
    const expected = solid(expectedKinds);
    const liveKinds = live.get(path);
    if (liveKinds === undefined) {
      const parent = parentOf(path);
      const holder = parent === null ? undefined : live.get(parent);
      // The holder must be an object live: an element path under an empty list
      // has nothing to be missing from.
      if (holder !== undefined && holder.has("object") && !path.endsWith("[]") && expected.size > 0) {
        drift.push({ path, problem: "missing", expected: [...expected].join("|") });
      }
      continue;
    }
    const got = solid(liveKinds);
    if (expected.size === 0 || got.size === 0) continue;
    if (![...expected].some((kind) => got.has(kind))) {
      drift.push({ path, problem: "changed", expected: [...expected].join("|"), got: [...got].join("|") });
    }
  }
  return drift;
}

/**
 * The fixture a live answer is an instance of: the one sharing the largest
 * share of its own paths with it. A Statuspage adapter reads a summary and an
 * incident history, and each has its own fixtures; comparing a summary against
 * the history fixture would report the whole file as missing.
 *
 * @param {Map<string, Set<string>>} live
 * @param {{ name: string, shape: Map<string, Set<string>> }[]} fixtures
 * @returns {{ name: string, shape: Map<string, Set<string>> } | null}
 */
export function bestFixture(live, fixtures) {
  let best = null;
  let bestScore = 0;
  for (const fixture of fixtures) {
    let shared = 0;
    for (const path of fixture.shape.keys()) if (live.has(path)) shared += 1;
    const score = shared / fixture.shape.size;
    if (score > bestScore) {
      best = fixture;
      bestScore = score;
    }
  }
  // Under half in common is not the same document at all — an endpoint the
  // fixtures do not cover, rather than a drifted one.
  return bestScore >= 0.5 ? best : null;
}

/**
 * The JSON fixtures an adapter's tests read, keyed by name.
 *
 * @param {string} root
 * @param {string} adapter
 * @returns {{ name: string, shape: Map<string, Set<string>> }[]}
 */
export function loadFixtures(root, adapter) {
  const dir = join(root, "test", "fixtures", adapter);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json") && !NOT_A_SHAPE.test(file))
    .map((file) => ({ name: file, shape: shapeOf(JSON.parse(readFileSync(join(dir, file), "utf8"))) }));
}

/**
 * @typedef {{ url: string, status: number, body: string, contentType: string }} Captured
 * @typedef {{
 *   id: string,
 *   adapter: string,
 *   outcome: "ok" | "drift" | "broken" | "unreachable",
 *   detail?: string,
 *   drift?: { url: string, fixture: string, items: ReturnType<typeof driftBetween> }[],
 * }} CanaryResult
 */

/**
 * What one provider's live read amounts to.
 *
 * Unreachable is kept apart from broken on purpose: a page answering 403 to a
 * datacentre IP, or timing out for a night, is the network's news, and an issue
 * opened over it every morning would be one nobody reads by the end of a week.
 *
 * @param {{ id: string, adapter: string }} entry
 * @param {{ captured: Captured[], error?: unknown, fixtures: { name: string, shape: Map<string, Set<string>> }[] }} read
 * @returns {CanaryResult}
 */
export function judge(entry, { captured, error, fixtures }) {
  const failedHttp = captured.find((response) => response.status < 200 || response.status >= 300);
  if (failedHttp !== undefined || (error !== undefined && captured.length === 0)) {
    const detail =
      failedHttp !== undefined
        ? `${failedHttp.url} answered HTTP ${failedHttp.status}`
        : error instanceof Error
          ? error.message
          : String(error);
    return { id: entry.id, adapter: entry.adapter, outcome: "unreachable", detail };
  }

  const drift = [];
  for (const response of captured) {
    if (!/json/i.test(response.contentType) && !/^\s*[[{]/.test(response.body)) continue;
    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      continue;
    }
    const live = shapeOf(parsed);
    const fixture = bestFixture(live, fixtures);
    if (fixture === null) continue;
    const items = driftBetween(fixture.shape, live);
    if (items.length > 0) drift.push({ url: response.url, fixture: fixture.name, items });
  }

  // The adapter itself is the final word: a page whose shape still matches
  // but no longer parses is broken however the comparison came out.
  if (error !== undefined) {
    return {
      id: entry.id,
      adapter: entry.adapter,
      outcome: "broken",
      detail: error instanceof Error ? error.message : String(error),
      drift,
    };
  }
  if (drift.length > 0) return { id: entry.id, adapter: entry.adapter, outcome: "drift", drift };
  return { id: entry.id, adapter: entry.adapter, outcome: "ok" };
}

const MAX_ITEMS = 15;

/**
 * The report, as the body of a GitHub issue. Findings first, the network's
 * noise after, and the healthy pages as a count: the issue is for what needs a
 * fixture re-recorded or an adapter fixed, not a census.
 *
 * @param {CanaryResult[]} results
 * @param {string} at ISO 8601
 * @returns {string}
 */
export function renderReport(results, at) {
  const findings = results.filter((result) => result.outcome === "drift" || result.outcome === "broken");
  const unreachable = results.filter((result) => result.outcome === "unreachable");
  const ok = results.filter((result) => result.outcome === "ok");
  const lines = [`Canary run of ${at}: ${results.length} catalog pages read through their real adapters.`, ""];

  if (findings.length === 0) {
    lines.push("No drift: every page that answered still matches the shape its adapter's fixtures describe.", "");
  } else {
    lines.push(`## Findings (${findings.length})`, "");
    for (const result of findings) {
      lines.push(`### \`${result.id}\` — ${result.adapter}, ${result.outcome}`, "");
      if (result.detail !== undefined) lines.push(`The adapter threw: \`${result.detail}\``, "");
      for (const entry of result.drift ?? []) {
        lines.push(`${entry.url} against \`test/fixtures/${result.adapter}/${entry.fixture}\`:`, "");
        for (const item of entry.items.slice(0, MAX_ITEMS)) {
          lines.push(
            item.problem === "missing"
              ? `- \`${item.path}\` is gone (was ${item.expected})`
              : `- \`${item.path}\` is now ${item.got} (was ${item.expected})`,
          );
        }
        if (entry.items.length > MAX_ITEMS) lines.push(`- … and ${entry.items.length - MAX_ITEMS} more`);
        lines.push("");
      }
    }
    lines.push(
      "Re-record the fixture with `node tools/record-fixture.mjs <url> <adapter> <name> --force` once the adapter reads the new shape, so the tests describe the page that actually ships.",
      "",
    );
  }

  if (unreachable.length > 0) {
    lines.push(`## Did not answer (${unreachable.length})`, "");
    for (const result of unreachable) lines.push(`- \`${result.id}\`: ${result.detail}`);
    lines.push("");
  }
  lines.push(`${ok.length} page(s) read cleanly.`, "");
  return lines.join("\n");
}

/** Whether a report carries anything an issue should be opened for. */
export const hasFindings = (results) =>
  results.some((result) => result.outcome === "drift" || result.outcome === "broken");

/**
 * Reads every catalog entry once, one at a time. Sequential on purpose: the
 * capture below is a wrapper around the global `fetch`, and two reads in flight
 * would each see the other's responses. Forty-odd pages in a row is a minute
 * or two, once a night.
 */
async function run(root, only) {
  const { CATALOG } = await import("../src/adapters/catalog.ts");
  const { getAdapter } = await import("../src/adapters/index.ts");
  const realFetch = globalThis.fetch;
  /** @type {Captured[]} */
  let captured = [];
  globalThis.fetch = async (input, init) => {
    const response = await realFetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = await response.clone().text();
    captured.push({ url, status: response.status, body, contentType: response.headers.get("content-type") ?? "" });
    return response;
  };

  /** @type {CanaryResult[]} */
  const results = [];
  try {
    for (const entry of CATALOG) {
      if (only !== null && !only.has(entry.id)) continue;
      captured = [];
      let error;
      try {
        await getAdapter(entry.adapter).fetchStatus(
          { id: entry.id, name: entry.name, baseUrl: entry.baseUrl, components: [] },
          { timeoutMs: TIMEOUT_MS },
        );
      } catch (caught) {
        error = caught;
      }
      const result = judge(entry, { captured, error, fixtures: loadFixtures(root, entry.adapter) });
      console.log(`${result.outcome.padEnd(11)} ${entry.id}${result.detail === undefined ? "" : ` — ${result.detail}`}`);
      results.push(result);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const reportAt = args.indexOf("--report");
  const onlyAt = args.indexOf("--only");
  const only = onlyAt === -1 ? null : new Set((args[onlyAt + 1] ?? "").split(","));
  const root = resolve(import.meta.dirname, "..");
  const results = await run(root, only);
  const report = renderReport(results, new Date().toISOString());
  if (reportAt !== -1) writeFileSync(args[reportAt + 1], report);
  else console.log(`\n${report}`);
  console.log(hasFindings(results) ? "canary: findings" : "canary: clean");
}
