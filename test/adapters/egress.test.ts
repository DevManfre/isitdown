import { test } from "node:test";
import assert from "node:assert/strict";
import type { Adapter, FetchContext, ServiceRef } from "../../src/core/adapter.interface.ts";
import { EgressRefusedError, configureOutbound, resetOutbound } from "../../src/core/outboundPolicy.ts";
import { dnsAdapter, resolverHost } from "../../src/adapters/dns.adapter.ts";
import { icmpAdapter } from "../../src/adapters/icmp.adapter.ts";
import { imapAdapter } from "../../src/adapters/imap.adapter.ts";
import { tcpAdapter } from "../../src/adapters/tcp.adapter.ts";

/**
 * Roadmap 9.1: the probes that open their own sockets — TCP, ICMP, the DNS
 * probe's resolver, IMAP — answer to the same egress policy as an HTTP read,
 * and are refused *before* anything is connected to. Every target here is a
 * literal address, so no case needs DNS.
 */

const ctx: FetchContext = { timeoutMs: 500 };
const ref = (baseUrl: string, options: Record<string, string> = {}): ServiceRef => ({
  id: "probe",
  name: "Probe",
  baseUrl,
  options,
});

const imapOptions = { user: "someone", passwordEnv: "EGRESS_TEST_IMAP_PASSWORD", from: "status@example.com" };

const cases: { label: string; adapter: Adapter; service: ServiceRef; refused: RegExp }[] = [
  { label: "tcp to the LAN", adapter: tcpAdapter, service: ref("tcp://192.168.1.10:5432"), refused: /192\.168\.1\.10 is a private address/ },
  { label: "tcp to loopback v6", adapter: tcpAdapter, service: ref("tcp://[::1]:5432"), refused: /::1 is a loopback address/ },
  { label: "tcp to cloud metadata", adapter: tcpAdapter, service: ref("tcp://169.254.169.254:80"), refused: /link-local/ },
  { label: "icmp to the LAN", adapter: icmpAdapter, service: ref("icmp://10.0.0.1"), refused: /10\.0\.0\.1 is a private address/ },
  {
    label: "dns via a LAN resolver",
    adapter: dnsAdapter,
    service: ref("https://example.com", { resolver: "192.168.1.1:53" }),
    refused: /192\.168\.1\.1 is a private address/,
  },
  { label: "imap on loopback", adapter: imapAdapter, service: ref("imaps://127.0.0.1:993", imapOptions), refused: /127\.0\.0\.1 is a loopback address/ },
];

for (const c of cases) {
  test(`egress policy refuses ${c.label} before connecting`, async (t) => {
    t.after(resetOutbound);
    configureOutbound({ privateTargets: "deny" });
    await assert.rejects(
      c.adapter.fetchStatus(c.service, ctx),
      (error: unknown) => error instanceof EgressRefusedError && c.refused.test(error.message),
    );
  });
}

test("EGRESS_ALLOW lets a listed probe target through", async (t) => {
  t.after(resetOutbound);
  configureOutbound({ privateTargets: "deny", allow: ["127.0.0.1"] });
  // Port 9 on loopback refuses the connection: a reading, not an egress refusal.
  const status = await tcpAdapter.fetchStatus(ref("tcp://127.0.0.1:9"), ctx);
  assert.equal(status.overallStatus, "major_outage");
});

test("a probe name that does not resolve is the probe's answer, not a refusal", async (t) => {
  t.after(resetOutbound);
  configureOutbound({ privateTargets: "deny" });
  const status = await tcpAdapter.fetchStatus(ref("tcp://does-not-exist.invalid:443"), ctx);
  assert.equal(status.overallStatus, "major_outage");
});

test("resolverHost takes the address out of a resolver option", () => {
  assert.equal(resolverHost("1.1.1.1"), "1.1.1.1");
  assert.equal(resolverHost("127.0.0.1:5353"), "127.0.0.1");
  assert.equal(resolverHost("[::1]:53"), "::1");
  assert.equal(resolverHost("2606:4700::1111"), "2606:4700::1111");
});
