import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { ArgsError } from "../../src/cli/watch/args.ts";
import { parseMcpArgs } from "../../src/cli/mcp/args.ts";
import { createReadApi } from "../../src/cli/mcp/api.ts";
import { PROTOCOL_VERSIONS, serveMcp } from "../../src/cli/mcp/server.ts";
import { TOOLS } from "../../src/cli/mcp/tools.ts";

/**
 * Roadmap 7.1: a fake MCP client drives every tool over the protocol, against
 * a fake UI edition — just enough of `/status`, `/history`, `/incidents`,
 * `/incidents/timeline` and `/annotations` to answer, shaped as
 * `src/ui/routes/*` answers them. Nothing here reaches a real instance.
 */

/** What a parsed answer is: read field by field, the way a client reads one. */
type Json = ReturnType<typeof JSON.parse>;

const NOW = new Date("2026-11-25T18:00:00.000Z");

type Route = (url: URL, req: IncomingMessage) => { status?: number; body: unknown } | undefined;

interface FakeServer {
  url: string;
  requests: { path: string; query: URLSearchParams; method: string; authorization: string | undefined }[];
  close(): Promise<void>;
}

function fakeServer(route: Route): Promise<FakeServer> {
  const requests: FakeServer["requests"] = [];
  return new Promise((resolve) => {
    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://fake");
      requests.push({ path: url.pathname, query: url.searchParams, method: req.method ?? "", authorization: req.headers.authorization });
      const answer = route(url, req) ?? { status: 404, body: { error: { message: `no route: ${url.pathname}` } } };
      res.writeHead(answer.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(answer.body));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

const statusBody = {
  serverNow: NOW.toISOString(),
  providers: [
    {
      id: "cloudflare",
      name: "Cloudflare",
      enabled: true,
      overallStatus: "degraded",
      fetchedAt: NOW.toISOString(),
      activeIncidents: [
        { id: "cf-1", name: "Elevated errors", impact: "minor", status: "investigating", updatedAt: NOW.toISOString(), extra: 1 },
      ],
      components: [{ id: "c", name: "CDN" }],
      uptime90: 99.5,
      suspected: null,
      stale: null,
      maintenance: { active: [], upcoming: [] },
    },
    { id: "github", name: "GitHub", enabled: true, overallStatus: "operational", fetchedAt: NOW.toISOString(), uptime90: 100 },
    { id: "old", name: "Old", enabled: false, overallStatus: "unknown", fetchedAt: null },
  ],
  groups: [],
};

function historyBody(providerId: string, days: string[], status: string, uptime: number | null) {
  return {
    providerId,
    buckets: days.map((day) => ({ day, status })),
    dailySeries: days.map((day) => ({ day, uptime })),
    uptime7: 99,
    uptime30: 99,
    uptime90: 99,
    sampleCount: uptime === null ? 0 : 288,
    incidentCount: 1,
    downtimeMinutes: 12,
    dailyCoverage: [],
    coverage: 1,
    previousUptime: null,
    detectionDelay: null,
  };
}

const incidents = [
  { providerId: "cloudflare", incidentId: "cf-2", name: "DNS resolution failures", impact: "major", startedAt: "2026-11-24T13:30:00.000Z", resolvedAt: "2026-11-24T15:45:00.000Z", status: "resolved" },
  { providerId: "cloudflare", incidentId: "cf-3", name: "Dashboard slow", impact: "minor", startedAt: "2026-11-24T14:50:00.000Z", resolvedAt: null, status: "monitoring" },
  { providerId: "github", incidentId: "gh-1", name: "Actions delays", impact: "minor", startedAt: "2026-11-20T09:00:00.000Z", resolvedAt: "2026-11-20T10:00:00.000Z", status: "resolved" },
];

const fleetRoute: Route = (url) => {
  switch (url.pathname) {
    case "/status":
      return { body: statusBody };
    case "/history": {
      const provider = url.searchParams.get("provider") ?? "";
      const from = url.searchParams.get("from");
      if (from !== null) return { body: historyBody(provider, [from], provider === "cloudflare" ? "partial_outage" : "operational", 96.5) };
      if (provider === "ghost") return { status: 404, body: { error: { message: "unknown provider: ghost" } } };
      return { body: historyBody(provider, ["2026-11-24", "2026-11-25"], "degraded", 98.2) };
    }
    case "/incidents/timeline":
      return { body: { days: Number(url.searchParams.get("days")), incidents: incidents.map(({ status: _s, ...row }) => row) } };
    case "/incidents": {
      const provider = url.searchParams.get("provider");
      const items = incidents.filter((row) => provider === null || row.providerId === provider);
      return {
        body: {
          active: [],
          page: { items: items.map((row) => ({ ...row, cost: null })), page: 1, pageSize: 100, total: items.length },
          counts: { all: items.length, active: 1, resolved: items.length - 1 },
        },
      };
    }
    case "/annotations":
      return {
        body: {
          annotations: [
            { id: 1, at: "2026-11-24T14:55:00.000Z", label: "v2.4.0 shipped", colour: "accent", providerId: null, createdAt: NOW.toISOString() },
          ],
        },
      };
    default:
      return undefined;
  }
};

/** A fake MCP client: writes JSON-RPC lines into the server, reads its answers back by id. */
function fakeClient(url: string, token = "") {
  const input = new PassThrough();
  const output = new PassThrough();
  const served = serveMcp(input, output, TOOLS, { api: createReadApi(url, token), now: () => NOW });
  const waiting = new Map<number, (message: Record<string, unknown>) => void>();
  const stray: unknown[] = [];
  const lines = createInterface({ input: output });
  lines.on("line", (line) => {
    const message = JSON.parse(line) as Record<string, unknown>;
    const resolve = waiting.get(message["id"] as number);
    if (resolve === undefined) stray.push(message);
    else resolve(message);
  });
  let nextId = 1;
  return {
    stray,
    request(method: string, params?: unknown): Promise<Record<string, unknown>> {
      const id = nextId++;
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`);
      });
    },
    send(raw: string): void {
      input.write(`${raw}\n`);
    },
    async callTool(name: string, args?: unknown): Promise<{ isError: boolean; text: string; json: () => Json }> {
      const message = await this.request("tools/call", { name, arguments: args });
      const result = message["result"] as { isError: boolean; content: { type: string; text: string }[] };
      const text = result.content[0]?.text ?? "";
      return { isError: result.isError, text, json: () => JSON.parse(text) };
    },
    async close(): Promise<void> {
      input.end();
      await served;
    },
  };
}

test("initialize answers the client's protocol version, the server's identity and a tools capability", async () => {
  const client = fakeClient("http://127.0.0.1:9");
  const answer = await client.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "fake", version: "0" },
  });
  const result = answer["result"] as Record<string, Json>;
  assert.equal(result["protocolVersion"], "2025-06-18");
  assert.deepEqual(result["capabilities"], { tools: { listChanged: false } });
  assert.equal(result["serverInfo"].name, "isitdown");

  const unknown = await client.request("initialize", { protocolVersion: "1999-01-01" });
  assert.equal((unknown["result"] as Record<string, unknown>)["protocolVersion"], PROTOCOL_VERSIONS[0]);
  await client.close();
});

test("tools/list names the five tools, each read-only with an object input schema", async () => {
  const client = fakeClient("http://127.0.0.1:9");
  const answer = await client.request("tools/list");
  const tools = (answer["result"] as { tools: Record<string, Json>[] }).tools;
  assert.deepEqual(
    tools.map((tool) => tool["name"]),
    ["fleet_status", "provider_history", "incidents_search", "status_at", "annotations_list"],
  );
  for (const tool of tools) {
    assert.equal(tool["inputSchema"].type, "object");
    assert.equal(tool["annotations"].readOnlyHint, true);
    assert.ok(tool["description"].length > 20);
  }
  await client.close();
});

test("fleet_status returns the fleet, filtered by provider, and names the ids it does not know", async () => {
  const server = await fakeServer(fleetRoute);
  const client = fakeClient(server.url, "secret");
  try {
    const all = (await client.callTool("fleet_status")).json();
    assert.equal(all.providers.length, 3);

    const call = await client.callTool("fleet_status", { providers: ["cloudflare", "nope"] });
    assert.equal(call.isError, false);
    const body = call.json();
    assert.equal(body.providers.length, 1);
    assert.equal(body.providers[0].overallStatus, "degraded");
    assert.deepEqual(body.providers[0].activeIncidents, [
      { name: "Elevated errors", impact: "minor", status: "investigating", updatedAt: NOW.toISOString() },
    ]);
    assert.equal(body.providers[0].uptime90, 99.5);
    assert.deepEqual(body.unknownProviders, ["nope"]);

    // Read-only by construction, with the token on every request.
    assert.ok(server.requests.every((request) => request.method === "GET"));
    assert.ok(server.requests.every((request) => request.authorization === "Bearer secret"));
  } finally {
    await client.close();
    await server.close();
  }
});

test("provider_history pairs each day's worst status with its uptime, over days or a from/to range", async () => {
  const server = await fakeServer(fleetRoute);
  const client = fakeClient(server.url);
  try {
    const body = (await client.callTool("provider_history", { provider: "cloudflare", from: "2026-11-24", to: "2026-11-24" })).json();
    assert.deepEqual(body.days, [{ day: "2026-11-24", worstStatus: "partial_outage", uptime: 96.5 }]);
    assert.equal(body.incidentCount, 1);
    assert.equal(server.requests.at(-1)?.query.get("from"), "2026-11-24");

    const fixed = (await client.callTool("provider_history", { provider: "github", days: 7 })).json();
    assert.equal(fixed.days.length, 2);
    assert.equal(server.requests.at(-1)?.query.get("days"), "7");

    const half = await client.callTool("provider_history", { provider: "github", from: "2026-11-24" });
    assert.equal(half.isError, true);
    assert.match(half.text, /from and to must be given together/);

    const missing = await client.callTool("provider_history", {});
    assert.equal(missing.isError, true);
    assert.match(missing.text, /^invalid arguments: provider/);
  } finally {
    await client.close();
    await server.close();
  }
});

test("incidents_search passes provider, text and state through, turns from into days and applies to itself", async () => {
  const server = await fakeServer(fleetRoute);
  const client = fakeClient(server.url);
  try {
    const body = (
      await client.callTool("incidents_search", { provider: "cloudflare", q: "DNS", state: "all", from: "2026-11-24", to: "2026-11-24" })
    ).json();
    const request = server.requests.at(-1);
    assert.equal(request?.query.get("provider"), "cloudflare");
    assert.equal(request?.query.get("q"), "DNS");
    assert.equal(request?.query.get("days"), "3");
    assert.equal(request?.query.get("pageSize"), "100");
    assert.deepEqual(
      body.incidents.map((row: { incidentId: string }) => row.incidentId),
      ["cf-2", "cf-3"],
    );
    assert.equal(body.truncated, false);

    const before = (await client.callTool("incidents_search", { to: "2026-11-21" })).json();
    assert.deepEqual(before.incidents.map((row: { incidentId: string }) => row.incidentId), ["gh-1"]);

    const limited = (await client.callTool("incidents_search", { limit: 1 })).json();
    assert.equal(limited.incidents.length, 1);
    assert.equal(limited.truncated, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("incidents_search reads further pages until it has enough", async () => {
  const rows = Array.from({ length: 150 }, (_, i) => ({
    providerId: "github",
    incidentId: `gh-${i}`,
    name: `Incident ${i}`,
    impact: "minor",
    startedAt: new Date(NOW.getTime() - i * 3_600_000).toISOString(),
    resolvedAt: null,
  }));
  const server = await fakeServer((url) => {
    const page = Number(url.searchParams.get("page"));
    const items = rows.slice((page - 1) * 100, page * 100);
    return { body: { active: [], page: { items, page, pageSize: 100, total: rows.length }, counts: { all: 150, active: 150, resolved: 0 } } };
  });
  const client = fakeClient(server.url);
  try {
    const body = (await client.callTool("incidents_search", { limit: 120 })).json();
    assert.equal(body.incidents.length, 120);
    assert.equal(body.truncated, true);
    assert.deepEqual(server.requests.map((request) => request.query.get("page")), ["1", "2"]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("status_at reports the incidents open at the instant, the status they imply and the day around it", async () => {
  const server = await fakeServer(fleetRoute);
  const client = fakeClient(server.url);
  try {
    // 15:00 in Rome yesterday: the DNS incident (major) and the dashboard one (minor) were both open.
    const body = (await client.callTool("status_at", { at: "2026-11-24T15:00:00+01:00", providers: ["cloudflare", "github", "nope"] })).json();
    assert.equal(body.at, "2026-11-24T14:00:00.000Z");
    const [cloudflare, github] = body.providers;
    assert.equal(cloudflare.status, "partial_outage");
    assert.deepEqual(cloudflare.openIncidents.map((row: { incidentId: string }) => row.incidentId), ["cf-2"]);
    assert.equal(cloudflare.dayWorstStatus, "partial_outage");
    assert.equal(cloudflare.dayUptime, 96.5);
    assert.equal(github.status, "operational");
    assert.deepEqual(github.openIncidents, []);
    assert.deepEqual(body.unknownProviders, ["nope"]);
    // The smallest timeline window that reaches back that far.
    assert.equal(server.requests.find((request) => request.path === "/incidents/timeline")?.query.get("days"), "7");

    // Without providers: every enabled one.
    const fleet = (await client.callTool("status_at", { at: "2026-11-24T15:00:00Z" })).json();
    assert.deepEqual(fleet.providers.map((row: { id: string }) => row.id), ["cloudflare", "github"]);
    assert.deepEqual(fleet.providers[0].openIncidents.map((row: { incidentId: string }) => row.incidentId), ["cf-2", "cf-3"]);

    const future = await client.callTool("status_at", { at: "2026-12-01T00:00:00Z" });
    assert.equal(future.isError, true);
    assert.match(future.text, /future/);
    const old = await client.callTool("status_at", { at: "2026-01-01T00:00:00Z" });
    assert.equal(old.isError, true);
    assert.match(old.text, /90 days/);
    const malformed = await client.callTool("status_at", { at: "yesterday at 3" });
    assert.equal(malformed.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("status_at says unknown, not operational, for a day nothing was measured", async () => {
  const server = await fakeServer((url) => {
    if (url.pathname === "/history") return { body: historyBody("github", [url.searchParams.get("from") ?? ""], "unknown", null) };
    if (url.pathname === "/incidents/timeline") return { body: { days: 30, incidents: [] } };
    return fleetRoute(url, undefined as never);
  });
  const client = fakeClient(server.url);
  try {
    const body = (await client.callTool("status_at", { at: "2026-11-10T12:00:00Z", providers: ["github"] })).json();
    assert.equal(body.providers[0].status, "unknown");
    assert.equal(server.requests.find((request) => request.path === "/incidents/timeline")?.query.get("days"), "30");
  } finally {
    await client.close();
    await server.close();
  }
});

test("annotations_list reads the markers over the window asked for", async () => {
  const server = await fakeServer(fleetRoute);
  const client = fakeClient(server.url);
  try {
    const body = (await client.callTool("annotations_list", { provider: "cloudflare", from: "2026-11-24", to: "2026-11-25" })).json();
    assert.deepEqual(body.annotations, [{ id: 1, at: "2026-11-24T14:55:00.000Z", label: "v2.4.0 shipped", providerId: null }]);
    const request = server.requests.at(-1);
    assert.equal(request?.path, "/annotations");
    assert.equal(request?.query.get("provider"), "cloudflare");
    assert.equal(request?.query.get("to"), "2026-11-25");
  } finally {
    await client.close();
    await server.close();
  }
});

test("a tool's failure is its own answer: the API's reason, a rejected token, an unreachable or malformed instance", async () => {
  const server = await fakeServer((url, req) => {
    if (req.headers.authorization !== "Bearer good") return { status: 401, body: { error: { message: "a valid token is required" } } };
    if (url.pathname === "/status") return { body: { providers: "not a list" } };
    return fleetRoute(url, req);
  });
  const good = fakeClient(server.url, "good");
  const bad = fakeClient(server.url, "bad");
  const nowhere = fakeClient("http://127.0.0.1:1");
  try {
    const rejected = await bad.callTool("fleet_status");
    assert.equal(rejected.isError, true);
    assert.match(rejected.text, /401: a valid token is required/);

    const apiReason = await good.callTool("provider_history", { provider: "ghost", days: 30 });
    assert.equal(apiReason.isError, true);
    assert.match(apiReason.text, /404: unknown provider: ghost/);

    const malformed = await good.callTool("fleet_status");
    assert.equal(malformed.isError, true);
    assert.match(malformed.text, /GET \/status/);

    const unreachable = await nowhere.callTool("fleet_status");
    assert.equal(unreachable.isError, true);
    assert.match(unreachable.text, /cannot reach http:\/\/127\.0\.0\.1:1/);

    const extra = await good.callTool("fleet_status", { providers: ["x"], bogus: true });
    assert.equal(extra.isError, true);
    assert.match(extra.text, /invalid arguments/);
  } finally {
    await Promise.all([good.close(), bad.close(), nowhere.close()]);
    await server.close();
  }
});

test("protocol errors: unknown tool, unknown method, a parse error, and silence for notifications", async () => {
  const client = fakeClient("http://127.0.0.1:9");
  const unknownTool = await client.request("tools/call", { name: "restart_everything" });
  assert.equal((unknownTool["error"] as { code: number }).code, -32602);
  const unknownMethod = await client.request("resources/list");
  assert.equal((unknownMethod["error"] as { code: number }).code, -32601);
  const ping = await client.request("ping");
  assert.deepEqual(ping["result"], {});

  client.send(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
  client.send("{not json");
  client.send(JSON.stringify({ jsonrpc: "1.0", id: 99, method: "ping" }));
  await client.request("ping");
  await client.close();
  assert.deepEqual(
    client.stray.map((message) => (message as { id: unknown; error: { code: number } }).error.code),
    [-32700, -32600],
  );
  assert.equal((client.stray[1] as { id: unknown }).id, 99);
});

test("parseMcpArgs: --url and --token, API_TOKEN by default, and the same errors as watch", () => {
  assert.deepEqual(parseMcpArgs([], {}), { url: "http://localhost:3000", token: "" });
  assert.deepEqual(parseMcpArgs([], { API_TOKEN: " env " }), { url: "http://localhost:3000", token: "env" });
  assert.deepEqual(parseMcpArgs(["--url", "http://fleet:4000", "--token", "flag"], { API_TOKEN: "env" }), {
    url: "http://fleet:4000",
    token: "flag",
  });
  const cases: [string[], string][] = [
    [["--interval", "5"], "cli.error.unknownOption"],
    [["--url"], "cli.error.missingValue"],
    [["--url", "not a url"], "cli.error.invalidUrl"],
  ];
  for (const [argv, key] of cases) {
    assert.throws(() => parseMcpArgs(argv, {}), (error: unknown) => error instanceof ArgsError && error.key === key);
  }
});

test("end to end: `isitdown mcp` over real stdio answers a client and stops when stdin closes", async () => {
  const server = await fakeServer(fleetRoute);
  const entry = fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));
  const child = spawn(process.execPath, [entry, "mcp", "--url", server.url], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, API_TOKEN: "" } });
  const answers: Record<string, Json>[] = [];
  createInterface({ input: child.stdout }).on("line", (line) => answers.push(JSON.parse(line)));
  const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "fleet_status", arguments: { providers: ["github"] } } })}\n`);
    const start = Date.now();
    while (answers.length < 2 && Date.now() - start < 10_000) await new Promise((resolve) => setTimeout(resolve, 10));
    child.stdin.end();
    assert.equal(await exited, 0);
    const byId = new Map(answers.map((answer) => [answer["id"], answer]));
    assert.equal(byId.get(1)?.["result"].serverInfo.name, "isitdown");
    assert.equal(JSON.parse(byId.get(2)?.["result"].content[0].text).providers[0].id, "github");
    assert.equal(answers.length, 2, "nothing but protocol on stdout");
  } finally {
    child.kill();
    await server.close();
  }
});

test("status_at reads an impact the way Statuspage defines it: critical is a major outage, none changes nothing", async () => {
  const open = (incidentId: string, impact: string) => ({
    providerId: "github",
    incidentId,
    name: incidentId,
    impact,
    startedAt: "2026-11-25T10:00:00.000Z",
    resolvedAt: null,
  });
  let rows = [open("a", "none"), open("b", "critical")];
  const server = await fakeServer((url) => {
    if (url.pathname === "/incidents/timeline") return { body: { days: 7, incidents: rows } };
    return fleetRoute(url, undefined as never);
  });
  const client = fakeClient(server.url);
  try {
    const at = { at: "2026-11-25T12:00:00Z", providers: ["github"] };
    assert.equal((await client.callTool("status_at", at)).json().providers[0].status, "major_outage");
    rows = [open("a", "none"), open("c", "maintenance")];
    assert.equal((await client.callTool("status_at", at)).json().providers[0].status, "operational");
  } finally {
    await client.close();
    await server.close();
  }
});

test("`isitdown mcp` with a bad option prints its usage on stderr and exits 2, leaving stdout empty", async () => {
  const entry = fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));
  const child = spawn(process.execPath, [entry, "mcp", "--bogus"], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
  assert.equal(code, 2);
  assert.equal(stdout, "");
  assert.match(stderr, /unknown option: --bogus/);
  assert.match(stderr, /usage: isitdown mcp/);
});
