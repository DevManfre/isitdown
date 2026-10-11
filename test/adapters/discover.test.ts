import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CATALOG } from "../../src/adapters/catalog.ts";
import { DISCOVERY_HINTS, discover, kindOf, namedIn, registrableDomain, registryOf } from "../../src/adapters/discover.ts";

/**
 * Roadmap 2.3: a project's own files, mapped onto the catalog. Held against a
 * small fixture project that names a dependency every way discovery reads one.
 */

const ROOT = new URL("../fixtures/discover/project/", import.meta.url).pathname;

function project(): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (name === "vendor") continue;
      if (statSync(path).isDirectory()) walk(path);
      else files.push({ path: relative(ROOT, path), content: readFileSync(path, "utf8") });
    }
  };
  walk(ROOT);
  return files;
}

const evidenceOf = (id: string): string[] =>
  discover(project(), CATALOG).providers.find((provider) => provider.entry.id === id)?.evidence.map((item) => `${item.file}: ${item.found}`) ?? [];

test("every kind of file the fixture holds is read", () => {
  const kinds = discover(project(), CATALOG).files.map((file) => file.kind).sort();
  assert.deepEqual(kinds, ["compose", "env", "go", "hosts", "npm", "pypi", "terraform"]);
});

test("one provider is proposed once, with every file that pointed at it", () => {
  assert.deepEqual(evidenceOf("aws").sort(), [
    "docker-compose.yml: public.ecr.aws/docker/library/redis:7",
    "package.json: @aws-sdk/client-s3",
    "requirements.txt: boto3",
  ]);
});

test("a host matches on its registrable domain, without a hint", () => {
  // SendGrid has no hint table entry for hosts: the status page's own domain
  // is what matches `api.sendgrid.com`.
  assert.deepEqual(evidenceOf("sendgrid"), [".env: api.sendgrid.com"]);
});

test("terraform sources and bare provider blocks both count", () => {
  assert.deepEqual(evidenceOf("gcp"), ["infra/main.tf: hashicorp/google"]);
  assert.deepEqual(evidenceOf("azure"), ["infra/main.tf: azurerm"]);
});

test("a bare image is Docker Hub and a registry host is its own provider", () => {
  assert.deepEqual(evidenceOf("docker"), ["docker-compose.yml: postgres:16"]);
  assert.deepEqual(evidenceOf("github"), ["docker-compose.yml: ghcr.io/acme/shop:latest"]);
});

test("local names are never proposed, and an unknown host is listed rather than probed", () => {
  const result = discover(project(), CATALOG);
  assert.deepEqual(result.unmatchedHosts, ["hooks.example-unknown.dev"]);
  const everything = JSON.stringify(result);
  assert.ok(!everything.includes("localhost") && !everything.includes("db.internal") && !everything.includes("10.0.0.4"));
});

test("a package nothing hints at proposes nothing", () => {
  assert.equal(JSON.stringify(discover([{ path: "package.json", content: '{"dependencies":{"left-pad":"1"}}' }], CATALOG).providers), "[]");
});

test("a malformed file is read as far as it goes and never throws", () => {
  assert.deepEqual(namedIn("package.json", "{ not json"), []);
  assert.deepEqual(namedIn("docker-compose.yml", "services: [unbalanced"), []);
});

test("a status-page host on a shared platform matches nobody else on it", () => {
  const catalog = [{ id: "acme", name: "Acme", adapter: "statuspage", baseUrl: "https://acme.statuspage.io" }];
  const result = discover([{ path: ".env", content: "X=https://other.statuspage.io" }], catalog);
  assert.deepEqual(result.providers, []);
});

test("file kinds come from the name alone", () => {
  assert.equal(kindOf("deploy/compose.prod.yaml"), "compose");
  assert.equal(kindOf("Dockerfile"), "dockerfile");
  assert.equal(kindOf(".env.production"), "env");
  assert.equal(kindOf("requirements-dev.txt"), "pypi");
  assert.equal(kindOf("/etc/hosts"), "hosts");
  assert.equal(kindOf("README.md"), null);
});

test("registries and registrable domains follow Docker's and the registries' rules", () => {
  assert.equal(registryOf("bitnami/redis:7"), "docker.io");
  assert.equal(registryOf("localhost:5000/app"), "localhost");
  assert.equal(registryOf("ghcr.io/acme/app@sha256:abc"), "ghcr.io");
  assert.equal(registrableDomain("api.sendgrid.com"), "sendgrid.com");
  assert.equal(registrableDomain("shop.example.co.uk"), "example.co.uk");
});

test("every hint names a provider the catalog has", () => {
  const ids = new Set(CATALOG.map((entry) => entry.id));
  for (const id of Object.keys(DISCOVERY_HINTS)) assert.ok(ids.has(id), `hint for unknown catalog id ${id}`);
});
