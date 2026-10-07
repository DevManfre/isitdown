import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  askOutpost,
  decideByConsensus,
  readOutposts,
  type ConsensusInput,
  type OutpostReading,
} from "../../src/core/outpost.ts";
import type { NormalizedStatus, OverallStatus } from "../../src/core/types.ts";

const reading = (overallStatus: OverallStatus, over: Partial<NormalizedStatus> = {}): NormalizedStatus => ({
  provider: "api",
  overallStatus,
  activeIncidents: [],
  components: [],
  maintenances: [],
  fetchedAt: "2026-10-07T10:00:00.000Z",
  ...over,
});

const saw = (outpost: string, status: OverallStatus): OutpostReading => ({
  outpost,
  status: reading(status, { provider: "api", fetchedAt: "2026-10-07T10:00:01.000Z" }),
});
const silent = (outpost: string): OutpostReading => ({ outpost, error: "connect ECONNREFUSED" });

// Each row: what this container saw, what the outposts said, what is kept.
const cases: { name: string; local: OverallStatus; remote: OutpostReading[]; kept: OverallStatus }[] = [
  { name: "no outposts: the local reading stands", local: "major_outage", remote: [], kept: "major_outage" },
  { name: "one outpost agreeing on down: down", local: "major_outage", remote: [saw("a", "major_outage")], kept: "major_outage" },
  { name: "one outpost seeing it up vetoes a local down", local: "major_outage", remote: [saw("a", "operational")], kept: "operational" },
  { name: "one outpost alone cannot invent a down", local: "operational", remote: [saw("a", "major_outage")], kept: "operational" },
  { name: "two of three see it down: down", local: "operational", remote: [saw("a", "major_outage"), saw("b", "major_outage")], kept: "major_outage" },
  { name: "only here sees it down, two of three up: up", local: "major_outage", remote: [saw("a", "operational"), saw("b", "operational")], kept: "operational" },
  { name: "here and one outpost down, one up: down", local: "major_outage", remote: [saw("a", "major_outage"), saw("b", "operational")], kept: "major_outage" },
  { name: "the middle severity wins across three", local: "major_outage", remote: [saw("a", "degraded"), saw("b", "operational")], kept: "degraded" },
  { name: "a silent outpost does not vote, and is never counted down", local: "operational", remote: [silent("a"), saw("b", "major_outage")], kept: "operational" },
  { name: "every outpost silent: the local reading stands", local: "major_outage", remote: [silent("a"), silent("b")], kept: "major_outage" },
  { name: "an outpost reading unknown does not vote", local: "major_outage", remote: [saw("a", "unknown")], kept: "major_outage" },
  { name: "a local unknown is not overturned by outposts alone", local: "unknown", remote: [saw("a", "operational"), saw("b", "operational")], kept: "unknown" },
];

for (const row of cases) {
  test(`consensus: ${row.name}`, () => {
    const decided = decideByConsensus({ status: reading(row.local) }, row.remote);
    assert.equal(decided.status.overallStatus, row.kept);
  });
}

test("an overturned reading keeps this poll's provider and timestamp, and says who outvoted it", () => {
  const local: ConsensusInput = {
    status: reading("major_outage"),
    note: { text: "connection refused on api.example.com:443", unreachable: true },
  };
  const decided = decideByConsensus(local, [saw("vps-1", "operational"), saw("vps-2", "operational")]);
  assert.equal(decided.status.provider, "api");
  assert.equal(decided.status.fetchedAt, "2026-10-07T10:00:00.000Z");
  assert.match(decided.note?.text ?? "", /^connection refused on api\.example\.com:443 — overruled by the outposts: /);
  assert.match(decided.note?.text ?? "", /here major_outage, vps-1 operational, vps-2 operational/);
  // The target answered the outposts, so "never answered" no longer describes it.
  assert.equal(decided.note?.unreachable, undefined);
});

test("a kept reading names a silent outpost, and a unanimous one adds nothing", () => {
  const kept = decideByConsensus({ status: reading("operational") }, [silent("vps-1"), saw("vps-2", "operational")]);
  assert.match(kept.note?.text ?? "", /vps-1 did not answer \(connect ECONNREFUSED\)/);

  const unanimous = decideByConsensus({ status: reading("operational") }, [saw("vps-1", "operational")]);
  assert.equal(unanimous.note, undefined);
});

test("readOutposts: nothing set is no outposts", () => {
  assert.deepEqual(readOutposts({}), []);
  assert.deepEqual(readOutposts({ OUTPOSTS: "  " }), []);
});

test("readOutposts: a comma-separated list, named by host, trailing slash dropped", () => {
  const outposts = readOutposts({
    OUTPOSTS: "https://vps-1.example.com:8080/, http://10.0.0.5:8080",
    OUTPOST_TOKEN: "s3cret",
  });
  assert.deepEqual(outposts, [
    { id: "vps-1.example.com:8080", url: "https://vps-1.example.com:8080", token: "s3cret" },
    { id: "10.0.0.5:8080", url: "http://10.0.0.5:8080", token: "s3cret" },
  ]);
});

test("readOutposts: refuses a list that cannot work rather than ignoring it", () => {
  assert.throws(() => readOutposts({ OUTPOSTS: "https://a.example" }), /OUTPOST_TOKEN/);
  assert.throws(() => readOutposts({ OUTPOSTS: "not a url", OUTPOST_TOKEN: "t" }), /not a URL/);
  assert.throws(() => readOutposts({ OUTPOSTS: "ftp://a.example", OUTPOST_TOKEN: "t" }), /http or https/);
  assert.throws(
    () => readOutposts({ OUTPOSTS: "https://a.example,https://a.example/", OUTPOST_TOKEN: "t" }),
    /more than once/,
  );
});

async function fakeOutpost(
  handler: (req: IncomingMessage, body: string, res: ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => handler(req, body, res));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const ref = { id: "api", name: "API", baseUrl: "https://api.example.com", options: { expectStatus: "200" } };

test("askOutpost sends the whole probe with the bearer token and returns what came back", async () => {
  let seen: { auth: string | undefined; path: string | undefined; body: unknown } | undefined;
  const outpost = await fakeOutpost((req, body, res) => {
    seen = { auth: req.headers.authorization, path: req.url, body: JSON.parse(body) };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: reading("degraded"), note: { text: "slow: 3200 ms" } }));
  });
  try {
    const answer = await askOutpost({ id: "vps", url: outpost.url, token: "s3cret" }, "http", ref, 2000);
    assert.deepEqual(seen, {
      auth: "Bearer s3cret",
      path: "/probe",
      body: { adapter: "http", service: ref, timeoutMs: 2000 },
    });
    assert.ok("status" in answer);
    assert.equal(answer.status.overallStatus, "degraded");
    assert.equal(answer.note, "slow: 3200 ms");
  } finally {
    await outpost.close();
  }
});

test("askOutpost abstains, with the reason, on an error status, a bad shape or no server", async () => {
  const refusing = await fakeOutpost((_req, _body, res) => {
    res.writeHead(401);
    res.end("{}");
  });
  const garbled = await fakeOutpost((_req, _body, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: { overallStatus: "fine" } }));
  });
  try {
    const a = await askOutpost({ id: "a", url: refusing.url, token: "t" }, "http", ref, 1000);
    assert.deepEqual(a, { outpost: "a", error: "answered HTTP 401" });
    const b = await askOutpost({ id: "b", url: garbled.url, token: "t" }, "http", ref, 1000);
    assert.deepEqual(b, { outpost: "b", error: "answered with an unexpected shape" });
  } finally {
    await Promise.all([refusing.close(), garbled.close()]);
  }
  const gone = await askOutpost({ id: "c", url: refusing.url, token: "t" }, "http", ref, 1000);
  assert.ok("error" in gone);
});
