import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attemptResolve,
  dnsAdapter,
  dnsConfig,
  noteFromOutcome,
  readingFromOutcome,
  resolutionReason,
  severityFromOutcome,
  type DnsOutcome,
  type DnsProbeConfig,
} from "../../src/adapters/dns.adapter.ts";
import type { FetchContext, ReadingNote, ServiceRef } from "../../src/core/adapter.interface.ts";
import type { StatusPageRead } from "../../src/core/http.ts";
import { withDnsServer } from "../helpers/localDns.ts";

/**
 * The adapter contract kit is deliberately not run here. Its harness hands an
 * adapter an `http://127.0.0.1:<port>` base url and a fake page to read, and
 * this adapter reads neither: its subject is a *name*, and a loopback literal
 * is the one thing there is nothing to resolve about. What the kit pins for
 * every other adapter — a valid reading in the documented shape, a target that
 * is not there never reading healthy, never hanging past the deadline — is
 * pinned below instead, against a real DNS server on the loopback.
 */

const service = (
  options: Record<string, string> = {},
  baseUrl = "https://api.example.com",
): ServiceRef => ({
  id: "my-name",
  name: "My name",
  baseUrl,
  options,
});

const config = (over: Partial<DnsProbeConfig> = {}): DnsProbeConfig => ({
  name: "api.example.com",
  recordType: "A",
  ...over,
});

const ctx: FetchContext = { timeoutMs: 2000 };

test("the name comes from the url's host, and the scheme and path are ignored", () => {
  assert.equal(dnsConfig(service({}, "https://api.example.com/v1/health")).name, "api.example.com");
  assert.equal(dnsConfig(service({}, "http://[2001:db8::1]")).name, "2001:db8::1");
});

test("the record type defaults to A and is read case-insensitively", () => {
  assert.equal(dnsConfig(service()).recordType, "A");
  assert.equal(dnsConfig(service({ recordType: "mx" })).recordType, "MX");
});

test("an unreadable option is our configuration's fault, so it throws", () => {
  assert.throws(() => dnsConfig(service({ recordType: "SOA" })), /recordType/);
  assert.throws(() => dnsConfig(service({ slowMs: "soon" })), /slowMs/);
  assert.throws(() => dnsConfig(service({ slowMs: "0" })), /slowMs/);
});

test("a name that resolves reads operational and reports nothing but severity", () => {
  const reading = readingFromOutcome(service(), config(), {
    answered: true,
    values: ["203.0.113.7"],
    latencyMs: 3,
  });
  assert.equal(reading.provider, "my-name");
  assert.equal(reading.overallStatus, "operational");
  assert.deepEqual(reading.activeIncidents, []);
  assert.deepEqual(reading.components, []);
  assert.deepEqual(reading.maintenances, []);
});

test("a failed resolution reads an outage, not a failed read", () => {
  for (const reason of ["ENOTFOUND", "SERVFAIL", "ETIMEOUT"]) {
    assert.equal(severityFromOutcome({ answered: false, reason }, config()), "major_outage");
  }
});

test("an answer with no records at all is an outage, not a missing field", () => {
  const empty: DnsOutcome = { answered: true, values: [], latencyMs: 2 };
  assert.equal(severityFromOutcome(empty, config()), "major_outage");
  assert.equal(noteFromOutcome(empty, config())?.unreachable, true);
});

test("expectValue turns 'it answered' into 'it answered correctly'", () => {
  const answered: DnsOutcome = { answered: true, values: ["203.0.113.7"], latencyMs: 2 };
  assert.equal(severityFromOutcome(answered, config({ expectValue: "203.0.113.7" })), "operational");
  assert.equal(severityFromOutcome(answered, config({ expectValue: "198.51.100.1" })), "major_outage");
  assert.match(
    noteFromOutcome(answered, config({ expectValue: "198.51.100.1" }))?.text ?? "",
    /resolved to 203\.0\.113\.7, without the expected "198\.51\.100\.1"/,
  );
});

test("a slow answer reads degraded, and only when a threshold was set", () => {
  const slow: DnsOutcome = { answered: true, values: ["203.0.113.7"], latencyMs: 900 };
  assert.equal(severityFromOutcome(slow, config()), "operational");
  assert.equal(severityFromOutcome(slow, config({ slowMs: 500 })), "degraded");
  assert.match(noteFromOutcome(slow, config({ slowMs: 500 }))?.text ?? "", /900 ms, at or over the 500 ms/);
});

test("the note names the question and the reason, and a healthy check says nothing", () => {
  const note = noteFromOutcome({ answered: false, reason: "ENOTFOUND" }, config());
  assert.equal(note?.text, "no answer for A api.example.com: ENOTFOUND");
  assert.equal(note?.unreachable, true);
  assert.equal(noteFromOutcome({ answered: true, values: ["203.0.113.7"], latencyMs: 2 }, config()), null);
});

test("node's own code is the reason, since it is the sentence worth reading", () => {
  const error = Object.assign(new Error("queryA ENOTFOUND api.example.com"), { code: "ENOTFOUND" });
  assert.equal(resolutionReason(error), "ENOTFOUND");
  assert.equal(resolutionReason(new Error("something else")), "something else");
  assert.equal(resolutionReason("not an error"), "not an error");
});

test("an A record on the wire resolves to its addresses", async () => {
  await withDnsServer({ kind: "a", addresses: ["203.0.113.7", "203.0.113.8"] }, async (resolver) => {
    const outcome = await attemptResolve(config({ resolver }), 2000);
    assert.equal(outcome.answered, true);
    assert.deepEqual(outcome.answered ? outcome.values : [], ["203.0.113.7", "203.0.113.8"]);
  });
});

test("a TXT record's chunks are joined, the way one is written down", async () => {
  await withDnsServer({ kind: "txt", values: ["v=spf1 -all"] }, async (resolver) => {
    const outcome = await attemptResolve(config({ recordType: "TXT", resolver }), 2000);
    assert.deepEqual(outcome.answered ? outcome.values : [], ["v=spf1 -all"]);
  });
});

test("NXDOMAIN is a reading, and it carries node's code as the reason", async () => {
  await withDnsServer({ kind: "rcode", rcode: 3 }, async (resolver) => {
    const outcome = await attemptResolve(config({ resolver }), 2000);
    assert.equal(outcome.answered, false);
    assert.equal(outcome.answered ? "" : outcome.reason, "ENOTFOUND");
  });
});

test("a resolver that never replies gives up on the timeout rather than hanging", async () => {
  await withDnsServer({ kind: "silence" }, async (resolver) => {
    const startedAt = Date.now();
    const outcome = await attemptResolve(config({ resolver }), 200);
    assert.equal(outcome.answered, false);
    assert.ok(Date.now() - startedAt < 3000, `gave up after ${Date.now() - startedAt} ms`);
  });
});

test("an unusable resolver address is ours to fix, so it throws", async () => {
  await assert.rejects(() => attemptResolve(config({ resolver: "not-an-address" }), 200), /resolver/);
});

test("fetchStatus records the answer as a read and a failure as a note", async () => {
  await withDnsServer({ kind: "a", addresses: ["203.0.113.7"] }, async (resolver) => {
    const reads: StatusPageRead[] = [];
    const notes: ReadingNote[] = [];
    const status = await dnsAdapter.fetchStatus(service({ resolver }), {
      ...ctx,
      onRead: (read) => reads.push(read),
      onNote: (note) => notes.push(note),
    });

    assert.equal(status.overallStatus, "operational");
    assert.equal(reads.length, 1);
    assert.deepEqual(notes, []);
  });

  await withDnsServer({ kind: "rcode", rcode: 3 }, async (resolver) => {
    const reads: StatusPageRead[] = [];
    const notes: ReadingNote[] = [];
    const status = await dnsAdapter.fetchStatus(service({ resolver }), {
      ...ctx,
      onRead: (read) => reads.push(read),
      onNote: (note) => notes.push(note),
    });

    assert.equal(status.overallStatus, "major_outage");
    assert.deepEqual(reads, []);
    assert.equal(notes[0]?.unreachable, true);
  });
});

test("the adapter is registered under its own id", async () => {
  const { getAdapter } = await import("../../src/adapters/index.ts");
  assert.equal(getAdapter("dns"), dnsAdapter);
});
