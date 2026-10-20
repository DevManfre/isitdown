import { test } from "node:test";
import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { createServer, type AddressInfo } from "node:net";
import { once } from "node:events";
import { createSyslogNotifier, syslogLine } from "../../src/notifiers/syslog.notifier.ts";
import { ChannelError } from "../../src/notifiers/errors.ts";
import { ALL_KINDS, flood, opened, payloadFor } from "./contract/fixtures.ts";

/**
 * Syslog (roadmap 3.9) against collectors on the loopback: a UDP socket and a
 * TCP server. The same properties the HTTP contract suite asserts — every kind
 * delivered, a failure typed, a long message cut to fit — checked over sockets.
 */

async function udpCollector(): Promise<{ port: number; next(): Promise<string>; close(): void }> {
  const socket = createSocket("udp4");
  socket.bind(0, "127.0.0.1");
  await once(socket, "listening");
  return {
    port: (socket.address() as AddressInfo).port,
    next: async () => String((await once(socket, "message"))[0]),
    close: () => socket.close(),
  };
}

async function tcpCollector(): Promise<{ port: number; next(): Promise<string>; close(): void }> {
  const frames: string[] = [];
  const waiting: ((frame: string) => void)[] = [];
  const server = createServer((connection) => {
    let data = "";
    connection.on("data", (chunk) => (data += String(chunk)));
    connection.on("end", () => {
      const resolve = waiting.shift();
      if (resolve === undefined) frames.push(data);
      else resolve(data);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    port: (server.address() as AddressInfo).port,
    next: () => new Promise((resolve) => (frames.length > 0 ? resolve(frames.shift() as string) : waiting.push(resolve))),
    close: () => server.close(),
  };
}

test("syslog: an RFC 5424 line over UDP, priority from facility and status", async () => {
  const collector = await udpCollector();
  try {
    const received = collector.next();
    await createSyslogNotifier({ url: `udp://127.0.0.1:${collector.port}`, facility: "local3" }).send(opened);
    const line = await received;
    // local3 (19) * 8 + crit (2) for a major outage.
    assert.match(line, /^<154>1 \S+ \S+ isitdown \d+ incident_opened \[isitdown@32473 provider="github" status="major_outage" key="isitdown\/github\/incident\/inc-1" url="https:\/\/www\.githubstatus\.com"\] /);
    assert.match(line, /🔴 GitHub — MAJOR OUTAGE — Incident: API requests failing \| Status: Investigating/);
    assert.ok(!line.includes("\n"), "a syslog line carries no line break");
  } finally {
    collector.close();
  }
});

test("syslog: over TCP each message is one octet-counted frame", async () => {
  const collector = await tcpCollector();
  try {
    const received = collector.next();
    await createSyslogNotifier({ url: `tcp://127.0.0.1:${collector.port}` }).send(payloadFor("status_change"));
    const frame = await received;
    const [length, ...rest] = frame.split(" ");
    const message = rest.join(" ");
    assert.equal(Number(length), Buffer.byteLength(message));
    // local0 (16) * 8 + warning (4) for a degradation.
    assert.match(message, /^<132>1 /);
  } finally {
    collector.close();
  }
});

test("syslog: every kind of change is delivered", async () => {
  const collector = await tcpCollector();
  try {
    const notifier = createSyslogNotifier({ url: `tcp://127.0.0.1:${collector.port}` });
    for (const kind of ALL_KINDS) {
      const received = collector.next();
      await notifier.send(payloadFor(kind));
      assert.match(await received, new RegExp(` ${kind} \\[`));
    }
  } finally {
    collector.close();
  }
});

test("syslog: a long message is cut to the transport's size, whole characters only", () => {
  const udp = syslogLine(flood, 16, "host", 2048);
  assert.ok(Buffer.byteLength(udp) <= 2048);
  assert.ok(udp.endsWith("…"));
  assert.ok(Buffer.byteLength(syslogLine(flood, 16, "host", 8192)) <= 8192);
});

test("syslog: a quote, a backslash or a bracket in a parameter is escaped", () => {
  const line = syslogLine(
    { ...opened, service: { ...opened.service, id: 'we"ird\\id]' } },
    16,
    "host",
    2048,
  );
  assert.match(line, /provider="we\\"ird\\\\id\\]"/);
});

test("syslog: a collector that is not there is a ChannelError", async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, "close");
  await assert.rejects(createSyslogNotifier({ url: `tcp://127.0.0.1:${port}` }).send(opened), (error: unknown) => {
    assert.ok(error instanceof ChannelError);
    assert.equal(error.channel, "syslog");
    assert.equal(error.status, undefined);
    assert.match(error.message, /^syslog notification failed: /);
    return true;
  });
});

test("syslog: a URL that is not udp, tcp or tls, or a facility outside local0-7, is refused", () => {
  assert.throws(() => createSyslogNotifier({ url: "http://collector" }), /url must be udp:\/\/, tcp:\/\/ or tls:\/\//);
  assert.throws(() => createSyslogNotifier({ url: "not a url" }), /url must be udp:\/\//);
  assert.throws(() => createSyslogNotifier({ url: "udp://c", facility: "kern" }), /facility must be local0 to local7/);
  assert.throws(() => createSyslogNotifier({ url: "" }), /url is required for the syslog channel/);
});

test("syslog: the default ports are the registered ones", async () => {
  // Built, not sent: only the parse is under test, and a send would reach for port 514.
  assert.doesNotThrow(() => createSyslogNotifier({ url: "udp://collector" }));
  assert.doesNotThrow(() => createSyslogNotifier({ url: "tls://[::1]" }));
});
