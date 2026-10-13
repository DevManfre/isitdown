import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerAdapter, parseDockerComponents, parseDockerStatus } from "../../src/adapters/docker.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";

/**
 * Roadmap 2.6: a Docker engine as a provider, its containers as components.
 * The two readings are held apart on purpose — the whole engine ignores a
 * container that is not trying to run, a selected one does not.
 */

const LIST = readFileSync(new URL("../fixtures/docker/containers.json", import.meta.url), "utf8");
const ENGINE: ServiceRef = { id: "nas", name: "NAS", baseUrl: "http://docker-proxy:2375" };

const select = (...ids: string[]): ServiceRef => ({
  ...ENGINE,
  components: ids.map((id) => ({ id, name: id })),
  scopeToComponents: true,
});

test("a selected container reads strictly: anything but running is an outage", () => {
  const status = parseDockerStatus(LIST, select("web", "db", "migrate", "worker", "cache", "backup", "proxy", "gone"));
  assert.deepEqual(
    Object.fromEntries(status.components.map((component) => [component.id, component.status])),
    {
      web: "operational",
      db: "operational",
      migrate: "major_outage",
      worker: "major_outage",
      cache: "major_outage",
      backup: "degraded",
      proxy: "unknown",
      gone: "major_outage",
    },
  );
});

test("the whole engine ignores containers that are not trying to run", () => {
  // web and db fine, worker unhealthy, cache crash-looping, backup paused,
  // proxy still starting, migrate a finished one-shot job that abstains.
  assert.equal(parseDockerStatus(LIST, ENGINE).overallStatus, "partial_outage");

  const calm = JSON.stringify(JSON.parse(LIST).filter((container: { Names: string[] }) => ["/web", "/db", "/migrate"].includes(container.Names[0]!)));
  assert.equal(parseDockerStatus(calm, ENGINE).overallStatus, "operational", "a stopped job does not make the engine red");
  assert.equal(parseDockerStatus("[]", ENGINE).overallStatus, "unknown");
});

test("scoping reads only the selected containers", () => {
  assert.equal(parseDockerStatus(LIST, select("web", "db")).overallStatus, "operational");
  assert.equal(parseDockerStatus(LIST, select("web", "worker")).overallStatus, "partial_outage");
  assert.equal(parseDockerStatus(LIST, select("migrate")).overallStatus, "major_outage");
  // Selected but not scoped: the components report, the engine reading stays whole.
  assert.equal(parseDockerStatus(LIST, { ...select("web"), scopeToComponents: false }).overallStatus, "partial_outage");
});

test("the picker lists every container by name, grouped by compose project", () => {
  const rows = parseDockerComponents(LIST, ENGINE);
  assert.deepEqual(
    rows.map((row) => `${row.group ?? "-"}/${row.id}`),
    ["-/backup", "-/cache", "-/proxy", "shop/db", "shop/migrate", "shop/web", "shop/worker"],
  );
});

test("a body that is not a container list throws, like a page that cannot be read", () => {
  assert.throws(() => parseDockerStatus("<html>", ENGINE), /not JSON/);
  assert.throws(() => parseDockerStatus('{"message":"page not found"}', ENGINE), /container list/);
});

test("socket must be an absolute path", () => {
  assert.deepEqual(dockerAdapter.validateOptions?.({ socket: "/var/run/docker.sock" }), []);
  assert.equal(dockerAdapter.validateOptions?.({ socket: "docker.sock" }).length, 1);
  assert.deepEqual(dockerAdapter.validateOptions?.(undefined), []);
});

async function engine(listen: (server: Server) => Promise<void>, answer = 200): Promise<{ server: Server; asked: string[] }> {
  const asked: string[] = [];
  const server = createServer((req, res) => {
    asked.push(req.url ?? "");
    res.writeHead(answer, { "content-type": "application/json" });
    res.end(answer === 200 ? LIST : '{"message":"forbidden"}');
  });
  await listen(server);
  return { server, asked };
}

const close = (server: Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

test("the engine is read over TCP, as through a socket proxy", async () => {
  const { server, asked } = await engine((s) => new Promise((resolve) => s.listen(0, "127.0.0.1", () => resolve())));
  try {
    const { port } = server.address() as AddressInfo;
    const status = await dockerAdapter.fetchStatus({ ...ENGINE, baseUrl: `http://127.0.0.1:${port}` }, { timeoutMs: 2000 });
    assert.equal(status.overallStatus, "partial_outage");
    assert.deepEqual(asked, ["/containers/json?all=1"]);
  } finally {
    await close(server);
  }
});

test("the engine is read over a unix socket, and the picker gets the same list", async () => {
  const socket = join(await mkdtemp(join(tmpdir(), "isitdown-docker-")), "docker.sock");
  const { server } = await engine((s) => new Promise((resolve) => s.listen(socket, () => resolve())));
  try {
    const service = { ...ENGINE, baseUrl: "http://localhost", options: { socket } };
    assert.equal((await dockerAdapter.fetchStatus(service, { timeoutMs: 2000 })).overallStatus, "partial_outage");
    assert.equal((await dockerAdapter.listComponents!(service, { timeoutMs: 2000 })).length, 7);
  } finally {
    await close(server);
  }
});

test("an engine that refuses the request is a failed read, not a reading", async () => {
  const { server } = await engine((s) => new Promise((resolve) => s.listen(0, "127.0.0.1", () => resolve())), 403);
  try {
    const { port } = server.address() as AddressInfo;
    await assert.rejects(dockerAdapter.fetchStatus({ ...ENGINE, baseUrl: `http://127.0.0.1:${port}` }, { timeoutMs: 2000 }), /answered 403/);
  } finally {
    await close(server);
  }
});
