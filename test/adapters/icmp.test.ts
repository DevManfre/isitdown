import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attemptPing,
  icmpAdapter,
  icmpConfig,
  noteFromOutcome,
  parsePingOutput,
  severityFromOutcome,
} from "../../src/adapters/icmp.adapter.ts";

/**
 * Roadmap 2.6: an ICMP echo through the system's own `ping`. The output of both
 * pings a deployment meets — busybox's in the image, iputils' on a host — is
 * held here as text, so the parsing is tested without a network at all.
 */

const BUSYBOX = `PING 1.1.1.1 (1.1.1.1): 56 data bytes
64 bytes from 1.1.1.1: seq=0 ttl=42 time=16.552 ms
64 bytes from 1.1.1.1: seq=1 ttl=42 time=18.218 ms

--- 1.1.1.1 ping statistics ---
2 packets transmitted, 2 packets received, 0% packet loss
round-trip min/avg/max = 16.552/17.385/18.218 ms
`;

const IPUTILS_LOSS = `PING 10.0.0.1 (10.0.0.1) 56(84) bytes of data.
64 bytes from 10.0.0.1: icmp_seq=1 ttl=64 time=1.77 ms

--- 10.0.0.1 ping statistics ---
3 packets transmitted, 1 received, 66.6667% packet loss, time 2003ms
rtt min/avg/max/mdev = 1.774/1.774/1.774/0.000 ms
`;

const BUSYBOX_SILENT = `PING 192.0.2.1 (192.0.2.1): 56 data bytes

--- 192.0.2.1 ping statistics ---
1 packets transmitted, 0 packets received, 100% packet loss
`;

test("both pings' summaries are read", () => {
  assert.deepEqual(parsePingOutput(BUSYBOX), { sent: 2, received: 2, avgMs: 17.385 });
  assert.deepEqual(parsePingOutput(IPUTILS_LOSS), { sent: 3, received: 1, avgMs: 1.774 });
  assert.deepEqual(parsePingOutput(BUSYBOX_SILENT), { sent: 1, received: 0, avgMs: undefined });
  assert.equal(parsePingOutput("ping: bad address 'nowhere.invalid'\n"), null);
});

test("severity: nothing back is down, some loss partial, slow degraded", () => {
  const config = { host: "router", count: 3, slowMs: 10 };
  const cases: [Parameters<typeof severityFromOutcome>[0], string][] = [
    [{ replied: false, reason: "bad address" }, "major_outage"],
    [{ replied: true, sent: 3, received: 0, avgMs: undefined }, "major_outage"],
    [{ replied: true, sent: 3, received: 1, avgMs: 2 }, "partial_outage"],
    [{ replied: true, sent: 3, received: 3, avgMs: 12 }, "degraded"],
    [{ replied: true, sent: 3, received: 3, avgMs: 2 }, "operational"],
  ];
  for (const [outcome, status] of cases) assert.equal(severityFromOutcome(outcome, config), status, JSON.stringify(outcome));
  assert.equal(severityFromOutcome({ replied: true, sent: 3, received: 3, avgMs: 500 }, { host: "router", count: 3 }), "operational");
});

test("a note says why, and only when something is wrong", () => {
  const config = { host: "router", count: 3, slowMs: 10 };
  assert.equal(noteFromOutcome({ replied: true, sent: 3, received: 3, avgMs: 2 }, config), null);
  assert.deepEqual(noteFromOutcome({ replied: false, reason: "no ping binary on this host" }, config), {
    text: "no ping to router: no ping binary on this host",
    unreachable: true,
  });
  assert.match(noteFromOutcome({ replied: true, sent: 3, received: 1, avgMs: 2 }, config)!.text, /answered 1 of 3/);
});

test("options: the host is baseUrl's, count and slowMs are bounded", () => {
  assert.deepEqual(icmpConfig({ id: "r", name: "r", baseUrl: "http://192.168.1.1" }), { host: "192.168.1.1", count: 3, slowMs: undefined });
  assert.equal(icmpConfig({ id: "r", name: "r", baseUrl: "http://[::1]" }).host, "::1");
  assert.equal(icmpConfig({ id: "r", name: "r", baseUrl: "http://r", options: { count: "5", slowMs: "50" } }).count, 5);
  assert.throws(() => icmpConfig({ id: "r", name: "r", baseUrl: "http://r", options: { count: "11" } }), /count must be/);
  assert.throws(() => icmpConfig({ id: "r", name: "r", baseUrl: "http://r", options: { slowMs: "fast" } }), /slowMs must be/);
  assert.deepEqual(icmpAdapter.validateOptions?.({ count: "2" }), []);
  assert.match(icmpAdapter.validateOptions?.({ count: "0" })[0] ?? "", /^count must be/);
});

test("a real ping of the loopback answers", async () => {
  const outcome = await attemptPing({ host: "127.0.0.1", count: 1 }, 2000);
  if (!outcome.replied && /no ping binary|permission|not permitted/i.test(outcome.reason)) return; // a sandbox with no ICMP at all
  assert.equal(outcome.replied, true, JSON.stringify(outcome));
  assert.equal(severityFromOutcome(outcome, { host: "127.0.0.1", count: 1 }), "operational");
});

test("a name that does not resolve is an answer, not a throw", async () => {
  const outcome = await attemptPing({ host: "nowhere.invalid", count: 1 }, 1000);
  assert.equal(outcome.replied, false);
  assert.equal(severityFromOutcome(outcome, { host: "nowhere.invalid", count: 1 }), "major_outage");
});
