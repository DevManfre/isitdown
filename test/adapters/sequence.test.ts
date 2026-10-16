import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  extractValue,
  sequenceAdapter,
  sequenceConfig,
  severityFromOutcome,
} from "../../src/adapters/sequence.adapter.ts";
import type { FetchContext, ReadingNote, ServiceRef } from "../../src/core/adapter.interface.ts";
import { withDeadServer, withServer } from "../helpers/localServer.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const ctx: FetchContext = { timeoutMs: 2000 };

const login: Record<string, string> = {
  "step1.method": "POST",
  "step1.path": "/login",
  "step1.body": '{"user":"probe","password":"hunter2"}',
  "step1.extract": "token=json:data.token",
  "step2.path": "/me",
  "step2.header.Authorization": "Bearer {{token}}",
};

const service = (options: Record<string, string> = login, baseUrl = "http://api.example.com"): ServiceRef => ({
  id: "my-api",
  name: "My API",
  baseUrl,
  options,
});

runAdapterContract("sequence", () => ({
  adapter: sequenceAdapter,
  service: (baseUrl) => service({ "step1.path": "/a", "step2.path": "/", expectBody: "ok" }, baseUrl),
  ok: { "/a": "ok", "/": "ok" },
  degraded: { "/a": "ok", "/": "ok" },
  subject: "response",
}));

/** The service the options above describe: log in for a token, then spend it. */
function api(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    if (req.method === "POST" && req.url === "/login") {
      const ok = Buffer.concat(chunks).toString().includes("hunter2");
      res.writeHead(ok ? 200 : 401, { "content-type": "application/json", "set-cookie": "sid=s3ssion; Path=/; HttpOnly" });
      res.end(ok ? JSON.stringify({ data: { token: "tok-123" } }) : "{}");
    } else if (req.url === "/me") {
      const authorised = req.headers.authorization === "Bearer tok-123" && req.headers.cookie === "sid=s3ssion";
      res.writeHead(authorised ? 200 : 401).end(authorised ? "welcome" : "no");
    } else {
      res.writeHead(404).end();
    }
  });
}

test("the value one step extracts is spent by the next, with the cookie it was given", async () => {
  await withServer(api, async (baseUrl) => {
    const status = await sequenceAdapter.fetchStatus(service(login, baseUrl), ctx);
    assert.equal(status.overallStatus, "operational");
  });
});

test("a healthy sequence records one read and explains nothing", async () => {
  await withServer(api, async (baseUrl) => {
    const reads: number[] = [];
    const notes: ReadingNote[] = [];
    await sequenceAdapter.fetchStatus(service(login, baseUrl), {
      ...ctx,
      onRead: (read) => reads.push(read.latencyMs),
      onNote: (note) => notes.push(note),
    });
    assert.equal(reads.length, 1);
    assert.deepEqual(notes, []);
  });
});

test("a step the service refuses reads an outage naming the step, never the credential", async () => {
  await withServer(api, async (baseUrl) => {
    const notes: ReadingNote[] = [];
    const wrong = { ...login, "step1.body": '{"user":"probe","password":"nope"}' };
    const status = await sequenceAdapter.fetchStatus(service(wrong, baseUrl), { ...ctx, onNote: (note) => notes.push(note) });
    assert.equal(status.overallStatus, "major_outage");
    assert.match(notes[0]?.text ?? "", /step 1 of 2: answered HTTP 401/);
    assert.doesNotMatch(notes[0]?.text ?? "", /nope|hunter2|tok-123/);
    assert.notEqual(notes[0]?.unreachable, true);
  });
});

test("the last step is the verdict: expectBody and expectStatus apply to it", async () => {
  await withServer(api, async (baseUrl) => {
    const wanted = await sequenceAdapter.fetchStatus(service({ ...login, expectBody: "welcome" }, baseUrl), ctx);
    assert.equal(wanted.overallStatus, "operational");
    const missing = await sequenceAdapter.fetchStatus(service({ ...login, expectBody: "goodbye" }, baseUrl), ctx);
    assert.equal(missing.overallStatus, "major_outage");
    const unexpected = await sequenceAdapter.fetchStatus(service({ ...login, "step2.expectStatus": "401" }, baseUrl), ctx);
    assert.equal(unexpected.overallStatus, "major_outage");
  });
});

test("a value the rule cannot find reads an outage, and says which rule", async () => {
  await withServer(api, async (baseUrl) => {
    const notes: ReadingNote[] = [];
    const status = await sequenceAdapter.fetchStatus(
      service({ ...login, "step1.extract": "token=json:data.missing" }, baseUrl),
      { ...ctx, onNote: (note) => notes.push(note) },
    );
    assert.equal(status.overallStatus, "major_outage");
    assert.match(notes[0]?.text ?? "", /json:data\.missing found no value for token/);
  });
});

test("an unreachable host reads an outage flagged as unanswered", async () => {
  await withDeadServer(async (baseUrl) => {
    const notes: ReadingNote[] = [];
    const status = await sequenceAdapter.fetchStatus(service(login, baseUrl), { ...ctx, onNote: (note) => notes.push(note) });
    assert.equal(status.overallStatus, "major_outage");
    assert.equal(notes[0]?.unreachable, true);
  });
});

test("an ${ENV} reference with nothing behind it is our configuration's fault, so it throws", async () => {
  await withServer(api, async (baseUrl) => {
    const options = { ...login, "step1.body": '{"password":"${ISITDOWN_TEST_UNSET_SECRET}"}' };
    await assert.rejects(sequenceAdapter.fetchStatus(service(options, baseUrl), ctx), /ISITDOWN_TEST_UNSET_SECRET/);
  });
});

test("an ${ENV} reference is resolved from the environment", async () => {
  process.env["ISITDOWN_TEST_SECRET"] = "hunter2";
  try {
    await withServer(api, async (baseUrl) => {
      const options = { ...login, "step1.body": '{"password":"${ISITDOWN_TEST_SECRET}"}' };
      assert.equal((await sequenceAdapter.fetchStatus(service(options, baseUrl), ctx)).overallStatus, "operational");
    });
  } finally {
    delete process.env["ISITDOWN_TEST_SECRET"];
  }
});

test("a slow sequence reads degraded, not down", () => {
  const config = sequenceConfig(service());
  assert.equal(severityFromOutcome({ ok: true, latencyMs: 900, lastStatus: 200 }, { ...config, slowMs: 500 }), "degraded");
  assert.equal(severityFromOutcome({ ok: true, latencyMs: 100, lastStatus: 200 }, { ...config, slowMs: 500 }), "operational");
});

test("the option surface throws on what is ours to fix", () => {
  assert.throws(() => sequenceConfig(service({ "step1.path": "/only" })), /at least 2 steps/);
  assert.throws(() => sequenceConfig(service({ "step1.path": "/a", "step3.path": "/c" })), /step2 is missing/);
  assert.throws(
    () => sequenceConfig(service({ "step1.path": "/a", "step2.path": "/b", "step3.path": "/c", "step4.path": "/d" })),
    /at most 3 steps/,
  );
  assert.throws(() => sequenceConfig(service({ ...login, "step1.method": "DELETE" })), /step1\.method DELETE/);
  assert.throws(() => sequenceConfig(service({ "step1.path": "/a", "step1.body": "x", "step2.path": "/b" })), /needs step1\.method POST/);
  assert.throws(() => sequenceConfig(service({ ...login, "step2.header.Authorization": "Bearer {{toekn}}" })), /\{\{toekn\}\}, which no earlier step extracts/);
  assert.throws(() => sequenceConfig(service({ ...login, "step1.extract": "token=cookie:sid" })), /step1\.extract line/);
  assert.throws(() => sequenceConfig(service({ ...login, "step1.extract": "token=regex:(" })), /does not compile/);
  assert.throws(() => sequenceConfig(service({ ...login, "step2.extract": "x=json:a" })), /last step/);
  assert.throws(() => sequenceConfig(service({ ...login, slowMs: "soon" })), /slowMs/);
});

test("validateOptions says it in one sentence without the adapter's own prefix", () => {
  assert.deepEqual(sequenceAdapter.validateOptions?.(login), []);
  assert.deepEqual(sequenceAdapter.validateOptions?.({}), ["needs at least 2 steps (step1.path, step2.path, …)"]);
});

test("extraction reads JSON paths with array indices, headers, and the first regex group", () => {
  const headers = new Headers({ "x-csrf": "abc" });
  const json = '{"data":{"items":[{"id":7}],"token":"t"}}';
  assert.equal(extractValue({ kind: "json", path: ["data", "token"] }, headers, json), "t");
  assert.equal(extractValue({ kind: "json", path: ["data", "items", "0", "id"] }, headers, json), "7");
  assert.equal(extractValue({ kind: "json", path: ["data", "nope"] }, headers, json), undefined);
  assert.equal(extractValue({ kind: "json", path: ["a"] }, headers, "<html>"), undefined);
  assert.equal(extractValue({ kind: "header", name: "x-csrf" }, headers, ""), "abc");
  assert.equal(extractValue({ kind: "regex", pattern: /name="csrf" value="([^"]+)"/ }, headers, '<input name="csrf" value="zz9">'), "zz9");
  assert.equal(extractValue({ kind: "regex", pattern: /\d+/ }, headers, "id 42"), "42");
});
