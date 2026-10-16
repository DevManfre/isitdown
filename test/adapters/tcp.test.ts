import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer as createHttp2Server, type Http2Server } from "node:http2";
import { createServer, type AddressInfo, type Server } from "node:net";
import { createServer as createTlsServer } from "node:tls";
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

// ---- roadmap 2.15: the `check` option ------------------------------------

const tlsMaterial = {
  key: readFileSync(new URL("../fixtures/tls/key.pem", import.meta.url)),
  cert: readFileSync(new URL("../fixtures/tls/cert.pem", import.meta.url)),
};

const listening = (server: { listen: Server["listen"]; address: Server["address"]; close: Server["close"] }): Promise<number> =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));

const aimed = (options: Record<string, string>, port: number, scheme = "http"): TcpProbeConfig =>
  tcpConfig(service(options, `${scheme}://127.0.0.1:${port}`));

test("the check option defaults to a bare connect and refuses a name it does not know", () => {
  assert.equal(tcpConfig(service()).check, "connect");
  assert.equal(tcpConfig(service({ check: "SMTP" })).check, "smtp");
  assert.throws(() => tcpConfig(service({ check: "ftp" })), /check "ftp"/);
  assert.throws(() => tcpConfig(service({ tls: "maybe" })), /tls must be yes or no/);
});

test("a check carries its own default port, and TLS follows the scheme or the check", () => {
  assert.equal(tcpConfig(service({ check: "smtp" }, "http://mail.internal")).port, 25);
  assert.equal(tcpConfig(service({ check: "grpc" }, "http://api.internal")).port, 50051);
  assert.equal(tcpConfig(service({ check: "tls" }, "http://ldap.internal")).port, 443);
  assert.equal(tcpConfig(service({ check: "tls" })).secure, true);
  assert.equal(tcpConfig(service({}, "https://api.internal")).secure, true);
  assert.equal(tcpConfig(service({ tls: "yes" }, "http://api.internal")).secure, true);
  assert.equal(tcpConfig(service({}, "http://api.internal")).secure, false);
});

test("tlsWarnDays without a TLS handshake is our configuration's fault", () => {
  assert.throws(() => tcpConfig(service({ tlsWarnDays: "14" })), /tlsWarnDays needs a TLS handshake/);
  assert.equal(tcpConfig(service({ check: "tls", tlsWarnDays: "14" })).tlsWarnDays, 14);
  assert.deepEqual(tcpAdapter.validateOptions?.({ check: "ftp" }), [`check "ftp" is not one of connect, tls, smtp, websocket, grpc`]);
  assert.deepEqual(tcpAdapter.validateOptions?.({ check: "tls" }), []);
});

test("a certificate nearing expiry reads degraded, and a far one operational", () => {
  const warn = config({ check: "tls", secure: true, tlsWarnDays: 30 });
  assert.equal(severityFromOutcome({ connected: true, latencyMs: 5, tlsDaysLeft: 12 }, warn), "degraded");
  assert.equal(severityFromOutcome({ connected: true, latencyMs: 5, tlsDaysLeft: 90 }, warn), "operational");
  assert.match(noteFromOutcome({ connected: true, latencyMs: 5, tlsDaysLeft: 12 }, warn)?.text ?? "", /expires in 12 day/);
  assert.equal(severityFromOutcome({ connected: true, latencyMs: 5 }, warn), "operational");
});

test("the tls check reads the days left on the certificate the port presents", async () => {
  const server = createTlsServer(tlsMaterial, (socket) => socket.end());
  const port = await listening(server);
  try {
    const outcome = await attemptConnect(aimed({ check: "tls", verify: "no" }, port), 2000);
    assert.equal(outcome.connected, true);
    assert.ok(outcome.connected && (outcome.tlsDaysLeft ?? 0) > 365, "the fixture certificate is good for years");

    const near = await tcpAdapter.fetchStatus(service({ check: "tls", verify: "no", tlsWarnDays: "999999" }, `http://127.0.0.1:${port}`), ctx);
    assert.equal(near.overallStatus, "degraded");
  } finally {
    server.close();
  }
});

test("the tls check refuses a certificate the runtime does not trust, unless told not to", async () => {
  const server = createTlsServer(tlsMaterial, (socket) => socket.end());
  const port = await listening(server);
  try {
    const refused = await attemptConnect(aimed({ check: "tls" }, port), 2000);
    assert.equal(refused.connected, false);
    assert.match(!refused.connected ? refused.reason : "", /self.signed|certificate/i);
  } finally {
    server.close();
  }
});

/** A server that speaks SMTP just far enough: greeting, EHLO, QUIT. */
function smtpServer(greeting: string, ehlo: string): Server {
  return createServer((socket) => {
    socket.write(greeting);
    socket.on("data", (chunk) => {
      const line = chunk.toString();
      if (line.startsWith("EHLO")) socket.write(ehlo);
      if (line.startsWith("QUIT")) socket.end("221 bye\r\n");
    });
    socket.on("error", () => undefined);
  });
}

test("the smtp check wants a 220 greeting and a 250 to EHLO, across a multi-line reply", async () => {
  const server = smtpServer("220 mx.example ESMTP\r\n", "250-mx.example\r\n250-SIZE 1000\r\n250 8BITMIME\r\n");
  const port = await listening(server);
  try {
    const outcome = await attemptConnect(aimed({ check: "smtp" }, port), 2000);
    assert.equal(outcome.connected, true);
  } finally {
    server.close();
  }
});

test("the smtp check reads a refusing greeting or a refused EHLO as down, with what was said", async () => {
  const busy = smtpServer("421 too busy\r\n", "250 ok\r\n");
  const rude = smtpServer("220 hello\r\n", "502 not today\r\n");
  const [busyPort, rudePort] = [await listening(busy), await listening(rude)];
  try {
    const first = await attemptConnect(aimed({ check: "smtp" }, busyPort), 2000);
    assert.match(!first.connected ? first.reason : "", /421 too busy/);
    const second = await attemptConnect(aimed({ check: "smtp" }, rudePort), 2000);
    assert.match(!second.connected ? second.reason : "", /EHLO with 502/);
  } finally {
    busy.close();
    rude.close();
  }
});

test("the smtp check times out on a server that accepts and never greets", async () => {
  await withListener(async (host, port) => {
    const outcome = await attemptConnect(aimed({ check: "smtp" }, port), 200);
    assert.equal(outcome.connected, false);
    assert.equal(!outcome.connected && outcome.reason, "timed out");
  });
});

/** An HTTP server that upgrades `/socket` to WebSocket with a correct accept token. */
function webSocketServer(honest: boolean): HttpServer {
  const server = createHttpServer((_req, res) => {
    res.writeHead(200).end("plain http");
  });
  server.on("upgrade", (req, socket) => {
    const key = String(req.headers["sec-websocket-key"]);
    const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${honest ? accept : "bogus"}\r\n\r\n`,
    );
    socket.on("error", () => undefined);
  });
  return server;
}

test("the websocket check wants a 101 with the accept token that matches its key", async () => {
  const good = webSocketServer(true);
  const bad = webSocketServer(false);
  const [goodPort, badPort] = [await listening(good), await listening(bad)];
  try {
    assert.equal((await attemptConnect(aimed({ check: "websocket", path: "/socket" }, goodPort), 2000)).connected, true);
    const mismatched = await attemptConnect(aimed({ check: "websocket" }, badPort), 2000);
    assert.match(!mismatched.connected ? mismatched.reason : "", /Sec-WebSocket-Accept/);
  } finally {
    good.close();
    bad.close();
  }
});

test("the websocket check reads a plain HTTP answer as down, naming the status", async () => {
  const server = createHttpServer((_req, res) => res.writeHead(200).end("hi"));
  const port = await listening(server);
  try {
    const outcome = await attemptConnect(aimed({ check: "websocket" }, port), 2000);
    assert.match(!outcome.connected ? outcome.reason : "", /HTTP 200 instead of upgrading/);
  } finally {
    server.close();
  }
});

/** A cleartext HTTP/2 server answering the standard gRPC health check. */
function grpcServer(reply: { status: number; grpcStatus?: string; message?: string; service?: (name: string) => number }): Http2Server {
  const server = createHttp2Server();
  server.on("stream", (stream) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      const request = Buffer.concat(chunks);
      // Frame header, then field 1 (0x0a) length-delimited: the service name, when there is one.
      const name = request.length > 5 ? request.subarray(7, 7 + (request[6] ?? 0)).toString() : "";
      const serving = reply.service === undefined ? reply.status : reply.service(name);
      stream.respond({ ":status": 200, "content-type": "application/grpc" }, { waitForTrailers: true });
      stream.on("wantTrailers", () =>
        stream.sendTrailers({
          "grpc-status": reply.grpcStatus ?? "0",
          ...(reply.message === undefined ? {} : { "grpc-message": reply.message }),
        }),
      );
      stream.end(Buffer.concat([Buffer.from([0, 0, 0, 0, 2, 0x08, serving])]));
    });
  });
  return server;
}

test("the grpc check wants SERVING from the standard health service", async () => {
  const server = grpcServer({ status: 1 });
  const port = await listening(server);
  try {
    assert.equal((await attemptConnect(aimed({ check: "grpc" }, port), 2000)).connected, true);
  } finally {
    server.close();
  }
});

test("the grpc check asks about the named service, and NOT_SERVING reads down", async () => {
  const server = grpcServer({ status: 1, service: (name) => (name === "orders.Orders" ? 2 : 1) });
  const port = await listening(server);
  try {
    assert.equal((await attemptConnect(aimed({ check: "grpc" }, port), 2000)).connected, true);
    const outcome = await attemptConnect(aimed({ check: "grpc", service: "orders.Orders" }, port), 2000);
    assert.match(!outcome.connected ? outcome.reason : "", /NOT_SERVING/);
  } finally {
    server.close();
  }
});

test("the grpc check reports a non-zero grpc-status with its message", async () => {
  const server = grpcServer({ status: 1, grpcStatus: "12", message: "unknown%20service" });
  const port = await listening(server);
  try {
    const outcome = await attemptConnect(aimed({ check: "grpc" }, port), 2000);
    assert.match(!outcome.connected ? outcome.reason : "", /grpc-status 12: unknown service/);
  } finally {
    server.close();
  }
});

test("the grpc check against something that is not HTTP/2 reads down instead of hanging", async () => {
  await withListener(async (host, port) => {
    const outcome = await attemptConnect(aimed({ check: "grpc" }, port), 300);
    assert.equal(outcome.connected, false);
  });
});
