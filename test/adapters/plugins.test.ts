import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPluginAdapters } from "../../src/adapters/plugins.ts";
import { adapters } from "../../src/adapters/index.ts";
import { createLogger } from "../../src/core/logger.ts";

/**
 * Plugin adapters from a directory — roadmap 1.13.
 *
 * The feature is one `import()`; everything worth testing is what happens when
 * the file is not what it claims to be. A plugin runs with the poller's own
 * privileges, so the two properties that matter are that a bad one cannot stop
 * the fleet being polled, and that no plugin can quietly become `statuspage`.
 */

const silent = createLogger("error", () => {});
const BUILT_IN = new Set(Object.keys(adapters));

async function pluginDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-plugins-"));
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body, "utf8");
  return dir;
}

const GOOD = `
export default {
  id: "acme",
  async fetchStatus(service) {
    return {
      provider: service.id,
      overallStatus: "operational",
      activeIncidents: [],
      components: [],
      maintenances: [],
      fetchedAt: new Date().toISOString(),
    };
  },
};
`;

test("a well-formed plugin is loaded and can be used like any other adapter", async () => {
  const dir = await pluginDir({ "acme.js": GOOD });
  const { adapters: loaded, problems } = await loadPluginAdapters(dir, BUILT_IN, silent);

  assert.deepEqual(problems, []);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.id, "acme");

  const reading = await loaded[0]?.fetchStatus(
    { id: "internal", name: "Internal", baseUrl: "https://internal.example" },
    { timeoutMs: 1000 },
  );
  assert.equal(reading?.overallStatus, "operational");
});

test("a named `adapter` export works too, for a file that also exports helpers", async () => {
  const dir = await pluginDir({
    "named.js": `export const helper = 1;\nexport const adapter = ${GOOD.replace("export default ", "").trim().replace(/;$/, "")};`,
  });
  const { adapters: loaded, problems } = await loadPluginAdapters(dir, BUILT_IN, silent);
  assert.deepEqual(problems, []);
  assert.equal(loaded[0]?.id, "acme");
});

test("a plugin may not take an id a built-in already has", async () => {
  // The one thing a plugin must not be able to do quietly: overriding
  // `statuspage` would change what every existing provider reads.
  const dir = await pluginDir({ "evil.js": GOOD.replace('"acme"', '"statuspage"') });
  const { adapters: loaded, problems } = await loadPluginAdapters(dir, BUILT_IN, silent);

  assert.deepEqual(loaded, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /already taken/);
  // And the real one is untouched.
  assert.equal(adapters["statuspage"]?.id, "statuspage");
});

test("two plugins cannot both claim one id, so behaviour never depends on filenames", async () => {
  const dir = await pluginDir({ "a.js": GOOD, "b.js": GOOD });
  const { adapters: loaded, problems } = await loadPluginAdapters(dir, BUILT_IN, silent);
  assert.equal(loaded.length, 1);
  assert.match(problems[0] ?? "", /already taken/);
});

test("a file that will not import is skipped by name, and its neighbours still load", async () => {
  const dir = await pluginDir({ "broken.js": "this is not javascript {{{", "acme.js": GOOD });
  const { adapters: loaded, problems } = await loadPluginAdapters(dir, BUILT_IN, silent);

  assert.equal(loaded.length, 1, "one bad file must not cost the fleet its good adapters");
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /^broken\.js could not be loaded/);
});

test("a module that is not an adapter says what it is missing", async () => {
  const dir = await pluginDir({
    "nothing.js": "export default 42;",
    "noid.js": "export default { fetchStatus() {} };",
    "badid.js": 'export default { id: "Not A Slug", fetchStatus() {} };',
    "nofetch.js": 'export default { id: "half" };',
    "badoptional.js": 'export default { id: "half", fetchStatus() {}, listComponents: 3 };',
  });
  const { adapters: loaded, problems } = await loadPluginAdapters(dir, BUILT_IN, silent);

  assert.deepEqual(loaded, []);
  assert.deepEqual(problems.sort(), [
    "badid.js is not an adapter: its id \"Not A Slug\" is not a lowercase slug: letters, digits and dashes",
    "badoptional.js is not an adapter: its listComponents is present but is not a function",
    "nofetch.js is not an adapter: it has no fetchStatus method",
    "noid.js is not an adapter: its id undefined is not a lowercase slug: letters, digits and dashes",
    "nothing.js is not an adapter: its default export is not an object",
  ]);
});

test("files that are not modules are ignored rather than reported", async () => {
  // A README beside the plugins, or a leftover `.json`, is not a broken plugin.
  const dir = await pluginDir({ "README.md": "# plugins", "data.json": "{}", "acme.js": GOOD });
  const { adapters: loaded, problems } = await loadPluginAdapters(dir, BUILT_IN, silent);
  assert.equal(loaded.length, 1);
  assert.deepEqual(problems, []);
});

test("a directory that is not there leaves the poller running", async () => {
  const lines: string[] = [];
  const logger = createLogger("warn", (line) => lines.push(line));
  const { adapters: loaded, problems } = await loadPluginAdapters(
    join(tmpdir(), "isitdown-no-such-plugins-dir"),
    BUILT_IN,
    logger,
  );
  assert.deepEqual(loaded, []);
  assert.deepEqual(problems, []);
  assert.match(lines.join("\n"), /plugin directory could not be read/);
});

test("every load is announced, because a plugin runs with this process's privileges", async () => {
  const lines: string[] = [];
  const logger = createLogger("warn", (line) => lines.push(line));
  const dir = await pluginDir({ "acme.js": GOOD });
  await loadPluginAdapters(dir, BUILT_IN, logger);
  assert.match(lines.join("\n"), /loaded a plugin adapter/);
  assert.match(lines.join("\n"), /acme/);
});
