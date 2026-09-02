// Records a provider's real answer once and saves it under test/fixtures/, so
// adapter tests are written against a shape that actually shipped rather than
// one hand-typed from the docs. Tests never touch a live provider; this script
// is the one place that does, run deliberately by a human.
//
// CLI: node tools/record-fixture.mjs <url> <provider> [name] [--force]
// The name defaults to "operational" — record incident and resolved states by
// running it again with a name while the provider is in that state.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const TIMEOUT_MS = 10_000;

/** Extensions worth distinguishing; anything else is recorded as plain text. */
const EXTENSIONS = [
  [/json/, "json"],
  [/xml|rss|atom/, "xml"],
  [/html/, "html"],
];

/**
 * The text to write and the extension to write it under. JSON is re-indented
 * so a later fixture update produces a readable diff; everything else is kept
 * byte for byte, since a scraper's fixture is only useful unaltered.
 *
 * A body typed as JSON that does not parse is a login page or an error blob:
 * recorded verbatim as text so it is obvious on sight rather than silently lost.
 *
 * @param {string} body
 * @param {string} contentType
 * @returns {{ text: string, extension: string }}
 */
export function formatBody(body, contentType) {
  const type = contentType.toLowerCase();
  if (/json/.test(type)) {
    try {
      return { text: `${JSON.stringify(JSON.parse(body), null, 2)}\n`, extension: "json" };
    } catch {
      return { text: body, extension: "txt" };
    }
  }
  const match = EXTENSIONS.find(([pattern]) => pattern.test(type));
  return { text: body, extension: match?.[1] ?? "txt" };
}

/**
 * Where a provider's fixtures live, one directory per provider.
 *
 * @param {string} root Repository root.
 * @param {string} provider
 * @param {string} name
 * @param {string} extension
 * @returns {string}
 */
export function fixturePath(root, provider, name, extension) {
  return join(root, "test", "fixtures", provider, `${name}.${extension}`);
}

/**
 * Fetches once and writes the answer. Throws on a non-2xx response: a fixture
 * of an error page would make an adapter test pass against something no
 * adapter should ever have to parse.
 *
 * @param {{ url: string, provider: string, name: string, root: string, force?: boolean }} options
 * @returns {Promise<string>} The path written.
 */
export async function recordFixture({ url, provider, name, root, force = false }) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`${url} answered HTTP ${response.status}; nothing recorded`);
  }
  const { text, extension } = formatBody(await response.text(), response.headers.get("content-type") ?? "");
  const target = fixturePath(root, provider, name, extension);
  if (!force && existsSync(target)) {
    throw new Error(`${target} already exists; re-run with --force to overwrite`);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  return target;
}

if (process.argv[1]?.endsWith("record-fixture.mjs")) {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const [url, provider, name = "operational"] = args.filter((arg) => arg !== "--force");
  if (url === undefined || provider === undefined) {
    console.error("usage: node tools/record-fixture.mjs <url> <provider> [name] [--force]");
    process.exit(2);
  }
  const root = resolve(import.meta.dirname, "..");
  try {
    console.log(`recorded ${await recordFixture({ url, provider, name, root, force })}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
