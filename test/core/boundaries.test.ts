import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";

const SHARED = ["src/core", "src/adapters", "src/notifiers"];
const EDITIONS = ["src/light", "src/ui"];
const UI_ONLY_MODULES = ["express", "node:sqlite"];

async function sourceFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

const importsOf = (source: string): string[] =>
  [...source.matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

/**
 * CLAUDE.md's golden rule, enforced rather than remembered: the shared engine
 * must not reach into an edition. Breaking it is how the two editions quietly
 * stop being the same engine.
 */
test("no shared module imports from an edition", async () => {
  const offenders: string[] = [];
  for (const dir of SHARED) {
    for (const file of await sourceFiles(dir)) {
      for (const specifier of importsOf(await readFile(file, "utf8"))) {
        if (!specifier.startsWith(".")) continue;
        const resolved = normalize(join(dirname(file), specifier)).split(sep).join("/");
        if (EDITIONS.some((edition) => resolved.startsWith(edition))) {
          offenders.push(`${file} imports ${specifier}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("no shared module imports an edition-only dependency", async () => {
  const offenders: string[] = [];
  for (const dir of SHARED) {
    for (const file of await sourceFiles(dir)) {
      for (const specifier of importsOf(await readFile(file, "utf8"))) {
        if (UI_ONLY_MODULES.includes(specifier)) offenders.push(`${file} imports ${specifier}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
