import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { parse } from "yaml";
import { CONFIG_SCHEMA_PATH, configJsonSchema } from "../../tools/config-schema.mjs";

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const committed = JSON.parse(read(CONFIG_SCHEMA_PATH)) as Record<string, unknown>;
const validate = new Ajv({ strict: false, allErrors: true }).compile(committed);

type Node = { properties?: Record<string, Node>; items?: Node; anyOf?: Node[]; description?: string };

/** Every property path in the schema whose node carries no description. */
function undescribed(node: Node, path: string): string[] {
  const missing: string[] = [];
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    const here = path === "" ? key : `${path}.${key}`;
    if (typeof child.description !== "string" || child.description.trim() === "") missing.push(here);
    missing.push(...undescribed(child, here));
  }
  if (node.items !== undefined) missing.push(...undescribed(node.items, `${path}[]`));
  for (const branch of node.anyOf ?? []) missing.push(...undescribed(branch, path));
  return missing;
}

test("the committed schema is the one the zod definition generates (run node tools/config-schema.mjs)", () => {
  assert.deepEqual(committed, JSON.parse(JSON.stringify(configJsonSchema())));
});

test("every key has a description, so the editor's tooltip is never empty", () => {
  assert.deepEqual(undescribed(committed as Node, ""), []);
});

test("config.example.yml points the editor at the published schema on its first line", () => {
  const first = read("config.example.yml").split("\n")[0];
  assert.equal(first, `# yaml-language-server: $schema=${committed["$id"] as string}`);
});

test("config.example.yml validates against the schema", () => {
  const ok = validate(parse(read("config.example.yml")));
  assert.equal(ok, true, JSON.stringify(validate.errors, null, 2));
});

test("a misspelt key fails, where the loader would drop it without a word", () => {
  const ok = validate({ pollIntervalMinute: 5, services: [{ id: "x", name: "X", adapter: "statuspage", baseUrl: "https://x" }] });
  assert.equal(ok, false);
  assert.equal(validate.errors?.[0]?.keyword, "additionalProperties");
});

test("a value the loader refuses fails here too", () => {
  const ok = validate({ services: [{ id: "Not A Slug", name: "X", adapter: "statuspage", baseUrl: "https://x" }] });
  assert.equal(ok, false);
});
