// The catalog generator — roadmap 2.1. The bundled catalog used to be a
// hand-written list of 42; this turns it into an artifact. It reads two sources
// of candidates — the curated seed in tools/catalog/seed.json and the "Public
// Status Pages" section of awesome-status-pages — runs each one through the
// same detection the dashboard's "paste a url" uses, then reads the result
// through its real adapter, and keeps only what actually answered.
//
// What it writes:
//   src/adapters/catalog.json   the bundled catalog the image ships
//   catalog/catalog.json        the same list, published for roadmap 2.2
//   catalog/report.md           every candidate that did not make it, and why
//
// An entry already in the catalog that fails tonight is kept, and named in the
// report: a provider whose page timed out once is not a provider that stopped
// existing, and this job commits without review.
//
// CLI: node tools/build-catalog.mjs [--no-remote] [--only <substring>] [--concurrency <n>]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = 10_000;
const AWESOME_URL = "https://raw.githubusercontent.com/ivbeg/awesome-status-pages/master/README.md";

/**
 * The `[Name](url)` links under one `## ` heading of a markdown document. Only
 * that section: the rest of the list is open-source software and hosted
 * services, which are tools for building a status page rather than a page.
 *
 * @param {string} markdown
 * @param {string} heading
 * @returns {{ name: string, url: string }[]}
 */
export function linksUnder(markdown, heading) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return [];
  const links = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    const match = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(line);
    if (match !== null) links.push({ name: match[1].trim(), url: match[2] });
  }
  return links;
}

/**
 * A list entry's name without the words every status page adds to it: "GitHub
 * Status Page" is GitHub in a picker that only lists status pages.
 *
 * @param {string} name
 */
export function cleanName(name) {
  const cleaned = name
    .replace(/\s*[-–—|:]?\s*(service\s+)?(system\s+)?status(\s+(page|api|dashboard))?\s*$/i, "")
    .trim();
  return cleaned === "" ? name.trim() : cleaned;
}

/**
 * A provider's name as an id the service schema accepts: lowercase, digits and
 * dashes, never starting with a dash.
 *
 * @param {string} name
 */
export function slugOf(name) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The host a candidate names, so two spellings of one page count once. */
function hostOf(url) {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Candidates from both sources, the seed first so its ids and names win, one
 * per host.
 *
 * @param {{ id?: string, name: string, url: string, adapter?: string }[]} seed
 * @param {{ name: string, url: string }[]} discovered
 */
export function candidatesFrom(seed, discovered) {
  const seen = new Set();
  const out = [];
  for (const entry of [...seed, ...discovered]) {
    const host = hostOf(entry.url);
    if (host === null) continue;
    // A path-addressed page (an Uptime.com account) is its own page; a bare
    // origin and the same origin with a slash are one.
    const path = entry.adapter === undefined ? "/" : new URL(/^https?:\/\//i.test(entry.url) ? entry.url : `https://${entry.url}`).pathname;
    const key = path === "/" ? host : `${host}${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = cleanName(entry.name);
    // Every catalog row is https (the catalog's own test holds it to that): a
    // list written years ago still links plenty of pages over http, and the
    // page that cannot answer https is not one to hand an operator.
    const url = entry.url.replace(/^http:\/\//i, "https://");
    out.push({ ...entry, url, name, id: entry.id ?? slugOf(name) });
  }
  return out;
}

/** Runs `work` over `items`, at most `limit` at a time, keeping their order. */
async function pool(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index], index);
      }
    }),
  );
  return results;
}

/**
 * One candidate's verdict: the entry it becomes, or why it does not.
 *
 * Detection alone is not enough — a page can serve something summary-shaped
 * that the adapter then cannot read — so the entry is read once through the
 * adapter detection named before it counts.
 */
async function verify(candidate, deps) {
  let adapter = candidate.adapter;
  let baseUrl = candidate.url;
  if (adapter === undefined) {
    const detected = await deps.detectAdapter(candidate.url, { timeoutMs: TIMEOUT_MS });
    if (detected.adapter === null) return { ok: false, reason: "no adapter recognises the page" };
    adapter = detected.adapter;
    baseUrl = detected.baseUrl ?? candidate.url;
  }
  const reader = deps.adapters[adapter];
  if (reader === undefined) return { ok: false, reason: `unknown adapter ${adapter}` };
  const entry = { id: candidate.id, name: candidate.name, adapter, baseUrl };
  const parsed = deps.serviceDefinitionSchema.safeParse(entry);
  if (!parsed.success) return { ok: false, reason: `not a valid service: ${parsed.error.issues[0]?.message}` };
  await reader.fetchStatus({ id: entry.id, name: entry.name, baseUrl }, { timeoutMs: TIMEOUT_MS });
  // A seed entry that names its adapter was confirmed by hand, page sharing
  // included — SendGrid's page is Twilio's, and both names belong in a picker.
  return { ok: true, entry, page: candidate.adapter === undefined ? await finalPage(baseUrl) : undefined };
}

/**
 * Where a page ends up once its redirects are followed. Two list entries for
 * `status.github.com` and `www.githubstatus.com` are one page, and only the
 * redirect says so. Falls back to the url itself when the origin will not
 * answer a plain GET — the read above already proved the page works.
 */
async function finalPage(baseUrl) {
  const url = new URL(baseUrl);
  try {
    const response = await fetch(url.origin, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    await response.body?.cancel();
    const host = new URL(response.url).hostname.replace(/^www\./, "");
    return `${host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return `${url.hostname.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}`;
  }
}

function report(at, kept, failed, retained) {
  const lines = [
    `# Catalog build`,
    "",
    `Generated ${at}: ${kept.length} providers in the catalog, ${failed.length} candidates left out.`,
    "",
  ];
  if (retained.length > 0) {
    lines.push("## Kept although they failed this run", "");
    lines.push("Already in the catalog, so a single failed read does not remove them.", "");
    for (const { candidate, reason } of retained) lines.push(`- **${candidate.name}** — ${candidate.url}: ${reason}`);
    lines.push("");
  }
  lines.push("## Left out", "");
  for (const { candidate, reason } of failed) lines.push(`- ${candidate.name} — ${candidate.url}: ${reason}`);
  return `${lines.join("\n")}\n`;
}

async function main(argv) {
  const flag = (name) => argv.includes(name);
  const option = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const concurrency = Number(option("--concurrency") ?? 12);
  const only = option("--only");

  const { detectAdapter } = await import("../src/adapters/detect.ts");
  const { adapters } = await import("../src/adapters/index.ts");
  const { serviceDefinitionSchema } = await import("../src/core/config.schema.ts");
  const deps = { detectAdapter, adapters, serviceDefinitionSchema };

  const seed = JSON.parse(readFileSync(resolve(root, "tools/catalog/seed.json"), "utf8")).entries;
  let discovered = [];
  if (!flag("--no-remote")) {
    const response = await fetch(AWESOME_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`awesome-status-pages answered HTTP ${response.status}`);
    discovered = linksUnder(await response.text(), "Public Status Pages");
  }
  let candidates = candidatesFrom(seed, discovered);
  if (only !== undefined) candidates = candidates.filter((candidate) => candidate.name.toLowerCase().includes(only.toLowerCase()));

  const previousPath = resolve(root, "src/adapters/catalog.json");
  const previous = JSON.parse(readFileSync(previousPath, "utf8")).entries;
  const previousById = new Map(previous.map((entry) => [entry.id, entry]));

  const verdicts = await pool(candidates, concurrency, async (candidate) => {
    try {
      return { candidate, ...(await verify(candidate, deps)) };
    } catch (error) {
      return { candidate, ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  });

  const kept = [];
  const failed = [];
  const retained = [];
  const ids = new Set();
  const urls = new Set();
  const pages = new Set();
  const keep = (entry, page) => {
    if (ids.has(entry.id) || urls.has(entry.baseUrl)) return false;
    if (page !== undefined && pages.has(page)) return false;
    ids.add(entry.id);
    urls.add(entry.baseUrl);
    if (page !== undefined) pages.add(page);
    kept.push(entry);
    return true;
  };
  for (const verdict of verdicts) {
    if (verdict.ok) {
      if (!keep(verdict.entry, verdict.page)) failed.push({ candidate: verdict.candidate, reason: "same id or page as an entry above" });
      continue;
    }
    const before = previousById.get(verdict.candidate.id);
    if (before !== undefined && keep(before)) retained.push(verdict);
    else failed.push(verdict);
  }
  // A filtered run must not drop everything it did not look at.
  if (only !== undefined) for (const entry of previous) keep(entry);

  const at = new Date().toISOString();
  const unchanged = JSON.stringify(kept) === JSON.stringify(previous);
  // `generatedAt` only moves when the list does, so a quiet week is no commit.
  const file = { generatedAt: unchanged ? JSON.parse(readFileSync(previousPath, "utf8")).generatedAt : at, entries: kept };
  const body = `${JSON.stringify(file, null, 2)}\n`;
  writeFileSync(previousPath, body);
  mkdirSync(resolve(root, "catalog"), { recursive: true });
  writeFileSync(resolve(root, "catalog/catalog.json"), body);
  writeFileSync(resolve(root, "catalog/report.md"), report(at, kept, failed, retained));
  console.log(
    `catalog: ${kept.length} kept (${retained.length} retained after a failed read), ${failed.length} left out${unchanged ? ", unchanged" : ""}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv.slice(2));
}
