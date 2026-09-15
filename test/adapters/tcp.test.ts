import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type AddressInfo, type Server } from "node:net";
import {
  attemptConnect,
  noteFromOutcome,
  readingFromOutcome,
  severityFromOutcome,
  tcpAdapter,
  tcpConfig,
  type TcpOutcome,
  type TcpProbeConfig,
} from "../../src/adapters/tcp.adapter.ts";
import type { FetchContext, ReadingNote, ServiceRef } from "../../src/core/adapter.interface.ts";
import type { StatusPageRead } from "../../src/core/http.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service = (
  options: Record<string, string> = {},
  baseUrl = "http://127.0.0.1:5432",
): ServiceRef => ({
  id: "my-db",
  name: "My database",
  baseUrl,
  options,
});

const config = (over: Partial<TcpProbeConfig> = {}): TcpProbeConfig => ({
  host: "127.0.0.1",
  port: 5432,
  ...over,
});

const ctx: FetchContext = { timeoutMs: 2000 };

/**
 * The contract, in transport form: the adapter connects to whatever the kit is
 * listening with, and never reads what it says afterwards. The kit's HTTP
 * routes are therefore beside the point here — what it exercises is that a
 * live target resolves into a valid reading and a dead one never reads healthy.
 */
runAdapterContract("tcp", () => ({
  adapter: tcpAdapter,
  service: (baseUrl) => service({}, baseUrl),
  ok: { "/": "irrelevant" },
  degraded: { "/": "irrelevant" },
  subject: "transport",
}));

/** A TCP server that accepts connections and says nothing, which is the point. */
async function withListener(run: (host: string, port: number, server: Server) => Promise<void>): Promise<void> {
  const server = createServer(() => {
    /* accepted, and deliberately silent: the handshake is the whole answer */
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run("127.0.0.1", port, server);
  } finally {
    server.close();
  }
}

test("the port comes from the option, then the url, then the scheme", () => {
  assert.equal(tcpConfig(service({ port: "6379" }, "http://db.internal:5432")).port, 6379);
  assert.equal(tcpConfig(service({}, "http://db.internal:5432")).port, 5432);
  assert.equal(tcpConfig(service({}, "https://db.internal")).port, 443);
  assert.equal(tcpConfig(service({}, "http://db.internal")).port, 80);
});

test("the host comes from the url, and the scheme is ignored", () => {
  assert.equal(tcpConfig(service({}, "https://db.internal/ignored/path")).host, "db.internal");
});

test("an unusable port is our configuration's fault, so it throws", () => {
  assert.throws(() => tcpConfig(service({ port: "postgres" })), /port/);
  assert.throws(() => tcpConfig(service({ port: "0" })), /1-65535/);
  assert.throws(() => tcpConfig(service({ port: "70000" })), /1-65535/);
  assert.throws(() => tcpConfig(service({ slowMs: "soon" })), /slowMs/);
  assert.throws(() => tcpConfig(service({ slowMs: "-5" })), /slowMs/);
});

test("an open port reads operational and reports nothing but severity", () => {
  const reading = readingFromOutcome(service(), config(), { connected: true, latencyMs: 4 });
  assert.equal(reading.provider, "my-db");
  assert.equal(reading.overallStatus, "operational");
  assert.deepEqual(reading.activeIncidents, []);
  assert.deepEqual(reading.components, []);
  assert.deepEqual(reading.maintenances, []);
});

test("a refused, reset or timed-out connection reads an outage, not a failed read", () => {
  for (const reason of ["connect ECONNREFUSED 127.0.0.1:5432", "read ECONNRESET", "timed out"]) {
    const outcome: TcpOutcome = { connected: false, reason };
    assert.equal(severityFromOutcome(outcome, config()), "major_outage");
  }
});

test("a slow handshake reads degraded, and only when a threshold was set", () => {
  const slow: TcpOutcome = { connected: true, latencyMs: 900 };
  assert.equal(severityFromOutcome(slow, config()), "operational");
  assert.equal(severityFromOutcome(slow, config({ slowMs: 500 })), "degraded");
  assert.equal(severityFromOutcome({ connected: true, latencyMs: 12 }, config({ slowMs: 500 })), "operational");
});

test("the note names the target and the reason, and flags an unanswered probe", () => {
  const note = noteFromOutcome({ connected: false, reason: "connect ECONNREFUSED 127.0.0.1:5432" }, config());
  assert.equal(note?.text, "no answer from 127.0.0.1:5432: connect ECONNREFUSED 127.0.0.1:5432");
  assert.equal(note?.unreachable, true);
});

test("a slow handshake explains itself, and a healthy one says nothing", () => {
  const slow = noteFromOutcome({ connected: true, latencyMs: 900 }, config({ slowMs: 500 }));
  assert.match(slow?.text ?? "", /900 ms, at or over the 500 ms threshold/);
  assert.equal(slow?.unreachable, undefined);
  assert.equal(noteFromOutcome({ connected: true, latencyMs: 4 }, config()), null);
});

test("a listening port answers, and a closed one reports why", async () => {
  await withListener(async (host, port) => {
    const open = await attemptConnect({ host, port }, 2000);
    assert.equal(open.connected, true);

    const closedPort = port;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const shut = await attemptConnect({ host, port: closedPort + 1 }, 2000);
    // Whatever the machine calls it, the reason has to name something.
    if (shut.connected) return; // something else is listening there; nothing to assert
    assert.ok(shut.reason.length > 0, shut.reason);
  });
});

test("a host that never completes a handshake gives up on the timeout", async () => {
  // 203.0.113.0/24 is TEST-NET-3: reserved for documentation, so nothing on the
  // way out can answer, and the attempt hangs until the deadline rather than
  // being refused.
  const outcome = await attemptConnect({ host: "203.0.113.1", port: 9 }, 150);
  assert.equal(outcome.connected, false);
});

test("fetchStatus records the handshake as a read and the failure as a note", async () => {
  await withListener(async (host, port) => {
    const reads: StatusPageRead[] = [];
    const notes: ReadingNote[] = [];
    const status = await tcpAdapter.fetchStatus(service({}, `http://${host}:${port}`), {
      ...ctx,
      onRead: (read) => reads.push(read),
      onNote: (note) => notes.push(note),
    });

    assert.equal(status.overallStatus, "operational");
    assert.equal(reads.length, 1);
    assert.equal(reads[0]?.notModified, false);
    // A healthy check explains nothing: a note every cycle would bury the ones
    // that matter.
    assert.deepEqual(notes, []);
  });
});

test("a target that is not there reports a note and no read at all", async () => {
  const reads: StatusPageRead[] = [];
  const notes: ReadingNote[] = [];
  const status = await tcpAdapter.fetchStatus(service({}, "http://203.0.113.1:9"), {
    timeoutMs: 150,
    onRead: (read) => reads.push(read),
    onNote: (note) => notes.push(note),
  });

  assert.equal(status.overallStatus, "major_outage");
  assert.deepEqual(reads, []);
  assert.equal(notes[0]?.unreachable, true);
});
