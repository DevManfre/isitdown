import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addCatalogKey, appendToTable, insertAfterLast, insertInBlock, scaffold } from "../../tools/scaffold.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;

test("a line joins the end of its block, before the brace that closes it", () => {
  const text = 'const a = {\n  one: 1,\n};\nconst b = {\n  two: 2,\n};';
  assert.equal(insertInBlock(text, "const b = {", "  three: 3,"), 'const a = {\n  one: 1,\n};\nconst b = {\n  two: 2,\n  three: 3,\n};');
  assert.throws(() => insertInBlock(text, "const c = {", "x"), /no block/);
});

test("an import goes after the last of its kind", () => {
  const text = 'import a from "./a.ts";\nimport b from "./b.ts";\n\ncode();';
  assert.equal(insertAfterLast(text, /^import /, 'import c from "./c.ts";'), 'import a from "./a.ts";\nimport b from "./b.ts";\nimport c from "./c.ts";\n\ncode();');
});

test("a row joins the end of the table its anchor is in, not the first table", () => {
  const text = "| a |\n|---|\n| x |\n\n| b |\n|---|\n| `cstate` |\n| y |\n\nprose";
  assert.equal(appendToTable(text, /`cstate`/, "| new |"), "| a |\n|---|\n| x |\n\n| b |\n|---|\n| `cstate` |\n| y |\n| new |\n\nprose");
});

test("a catalog key is added last, keeping the layout, and never twice", () => {
  const text = '{\n  "a": "A"\n}\n';
  const added = addCatalogKey(text, "b", "B");
  assert.equal(added, '{\n  "a": "A",\n  "b": "B"\n}\n');
  assert.throws(() => addCatalogKey(added, "b", "B"), /already has/);
});

test("an id that is not lower-case words joined by hyphens is refused", () => {
  assert.throws(() => scaffold("adapter", "Bad_Id", "/nowhere"), /not an id/);
  assert.throws(() => scaffold("plugin", "x", "/nowhere"), /unknown kind/);
});

/**
 * The acceptance test of roadmap 13.8: generated into a copy of the repo, an
 * adapter and a notifier compile with the project's own strict settings, and
 * their tests fail — saying they are not implemented — rather than pass empty.
 */
test("a generated adapter and notifier compile, and their tests fail until implemented", { timeout: 120_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "isitdown-scaffold-"));
  try {
    for (const path of ["src", "test", "docs", "package.json", "tsconfig.json"]) {
      cpSync(join(ROOT, path), join(dir, path), { recursive: true });
    }
    symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"));

    const adapter = scaffold("adapter", "acme-status", dir);
    const notifier = scaffold("notifier", "acme-push", dir);
    for (const path of [...adapter.created, ...notifier.created]) assert.ok(existsSync(join(dir, path)), path);

    // Registered, and documented in both languages.
    assert.match(readFileSync(join(dir, "src/adapters/index.ts"), "utf8"), /\[acmeStatusAdapter\.id\]: acmeStatusAdapter,/);
    assert.match(readFileSync(join(dir, "src/notifiers/index.ts"), "utf8"), /"acme-push": createAcmePushNotifier,/);
    for (const doc of ["docs/configuration.md", "docs/configuration.it.md"]) {
      const text = readFileSync(join(dir, doc), "utf8");
      assert.match(text, /^\| `acme-status` \| TODO/m);
      assert.match(text, /^\| Acme Push \| `acme-push` \| TODO \|$/m);
    }
    for (const locale of ["en", "de", "es", "fr", "it", "pt"]) {
      assert.equal(JSON.parse(readFileSync(join(dir, `src/ui/web/locales/${locale}.json`), "utf8"))["channel.name.acme-push"], "Acme Push");
    }

    // Typechecked with the project's own options: the generated files and their
    // tests, plus everything they import. Only errors *in* the generated files
    // count — `tsconfig.json` covers src/ alone, so a shared test helper they
    // import is not this check's to judge.
    const files = [...adapter.created, ...notifier.created].filter((path) => path.endsWith(".ts"));
    writeFileSync(
      join(dir, "tsconfig.scaffold.json"),
      JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { rootDir: ".", noEmit: true }, include: [], files }),
    );
    const tsc = spawnSync(join(ROOT, "node_modules/.bin/tsc"), ["-p", "tsconfig.scaffold.json"], { cwd: dir, encoding: "utf8" });
    const errors = tsc.stdout.split("\n").filter((line) => files.some((file) => line.startsWith(file)));
    assert.deepEqual(errors, []);

    for (const path of files.filter((file) => file.startsWith("test/"))) {
      // Without NODE_TEST_CONTEXT: inherited from this runner, it makes the
      // child report to us instead of exiting with its own status.
      const { NODE_TEST_CONTEXT: _, ...env } = process.env;
      const run = spawnSync(process.execPath, ["--test", path], { cwd: dir, encoding: "utf8", env });
      assert.notEqual(run.status, 0, `${path} passed before anything was implemented`);
      assert.match(run.stdout + run.stderr, /not implemented yet/, `${path} failed for some other reason`);
    }

    // A second run of the same id is refused, and changes nothing.
    const before = readFileSync(join(dir, "src/notifiers/index.ts"), "utf8");
    assert.throws(() => scaffold("notifier", "acme-push", dir), /already/);
    assert.equal(readFileSync(join(dir, "src/notifiers/index.ts"), "utf8"), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
