import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { fileConfigSchema } from "../../src/light/config/schema.ts";
import { BASE_PATH_CEILING, basePathKeys, inventory, render, schemaKeyPaths } from "../../tools/complexity-inventory.mjs";

const example = readFileSync(new URL("../../config.example.yml", import.meta.url), "utf8");

test("the base path in config.example.yml stays within its ceiling", () => {
  const keys = basePathKeys(example);
  assert.ok(keys.length <= BASE_PATH_CEILING, `${keys.length} keys over a ceiling of ${BASE_PATH_CEILING}: ${keys.join(", ")}`);
});

test("the base path alone is a configuration the Light edition accepts", () => {
  assert.equal(fileConfigSchema.safeParse(parse(example)).success, true);
});

test("a base path key counts once however many providers repeat it, and a comment counts nothing", () => {
  const keys = basePathKeys(
    ["services:", "  - id: a", "    name: A", "  - id: b", "    name: B", "# routing:", "#   - provider: a"].join("\n"),
  );
  assert.deepEqual(keys, ["services[].id", "services[].name"]);
});

test("schema key paths see through wrappers, arrays and unions", () => {
  const schema = z.object({
    a: z.number().optional(),
    b: z.array(z.object({ c: z.string().default("") })),
    d: z.union([z.object({ e: z.string() }), z.object({ e: z.string(), f: z.boolean() })]),
    g: z.record(z.string()),
  });
  assert.deepEqual(schemaKeyPaths(schema), ["a", "b[].c", "d.e", "d.f", "g"]);
});

test("the inventory is the same table on every run, with a row per subsystem and a total", async () => {
  const first = render(await inventory());
  assert.equal(render(await inventory()), first);
  for (const label of ["Core", "Adapters", "Notifiers", "Light edition", "UI server", "Dashboard", "CLI", "Outpost", "Packaging", "**Total**"]) {
    assert.match(first, new RegExp(`^\\| ${label.replace(/\*/g, "\\*")}`, "m"));
  }
  assert.match(first, new RegExp(`ceiling ${BASE_PATH_CEILING}\\.$`));
});
