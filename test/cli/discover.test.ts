import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";
import { CATALOG } from "../../src/adapters/catalog.ts";
import { discover } from "../../src/adapters/discover.ts";
import { collectFiles, renderText, renderYaml } from "../../src/cli/discover/run.ts";
import { serviceDefinitionSchema } from "../../src/core/config.schema.ts";

const ROOT = new URL("../fixtures/discover/project/", import.meta.url).pathname;

test("a directory is walked, other people's code left out", () => {
  const paths = collectFiles([ROOT]).map((file) => file.path).sort();
  assert.ok(paths.includes("infra/main.tf"));
  assert.ok(!paths.some((path) => path.startsWith("vendor")), "vendor is someone else's code");
});

test("a single file can be named directly", () => {
  assert.equal(collectFiles([`${ROOT}package.json`]).length, 1);
});

test("the --yaml block is services a Light config accepts", () => {
  const doc = parse(renderYaml(discover(collectFiles([ROOT]), CATALOG))) as { services: unknown[] };
  assert.ok(doc.services.length > 5);
  for (const service of doc.services) assert.equal(serviceDefinitionSchema.safeParse(service).success, true);
});

test("the text report names each provider with its evidence and the hosts left over", () => {
  const text = renderText(discover(collectFiles([ROOT]), CATALOG));
  assert.match(text, /Amazon Web Services \(aws\)\n {4}docker-compose\.yml: public\.ecr\.aws/);
  assert.match(text, /hooks\.example-unknown\.dev/);
});

test("a directory with nothing readable says so", () => {
  assert.match(renderText(discover([], CATALOG)), /No file discovery can read/);
});
