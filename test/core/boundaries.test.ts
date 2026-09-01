import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";

const SHARED = ["src/core", "src/adapters", "src/notifiers"];
const EDITIONS = ["src/light", "src/ui"];
/**
 * Packages that belong to one edition and must never appear in the shared
 * engine. `express` and `node:sqlite` are the UI edition's server; everything
 * after them is the React dashboard, which Vite bundles into static assets at
 * image-build time and which is absent from both runtime images (the Docker
 * stages install with `--omit=dev`).
 *
 * The dashboard entries were added after the React port: `src/core` importing
 * `react` or `@tanstack/react-query` would break the golden rule exactly as
 * importing `express` would, and would additionally put a devDependency on the
 * Light edition's runtime path, where it does not exist. Before this the list
 * covered only the server, so a shared module could have reached for any of
 * these unnoticed.
 */
const UI_ONLY_MODULES = [
  // UI edition server
  "express",
  "node:sqlite",
  // dashboard runtime
  "react",
  "react-dom",
  "react-dom/client",
  "react-router",
  "react-i18next",
  "i18next",
  "@tanstack/react-query",
  "recharts",
  "radix-ui",
  "lucide-react",
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
  "tailwindcss",
];

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
        // Match the package root, not just the exact string: "react-dom/client"
        // and "recharts/es6/chart" are the same dependency as their bare names,
        // and an exact-match check would wave both through.
        const root = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : (specifier.split("/")[0] ?? specifier);
        if (UI_ONLY_MODULES.includes(specifier) || UI_ONLY_MODULES.includes(root)) {
          offenders.push(`${file} imports ${specifier}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});
