import { createHash, randomBytes } from "node:crypto";
import { connect as http2Connect } from "node:http2";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as netConnect, isIP, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

/**
 * The handshakes the `tcp` adapter can speak beyond a bare connect — roadmap
 * 2.15. Each one answers a slightly larger question than "is the port open",
 * and none of them is a protocol client: they say the one sentence a service
 * of that kind says when it is healthy, and hang up.
 *
 * Every function here resolves, never rejects. A target that refuses, resets,
 * answers nonsense or says nothing is this check's *answer*, so it travels as
 * a reason and the adapter turns it into a severity.
 */

export const TCP_CHECKS = ["connect", "tls", "smtp", "websocket", "grpc"] as const;
export type TcpCheck = (typeof TCP_CHECKS)[number];

/** What one handshake needs to know; a subset of the adapter's config. */
export interface HandshakeTarget {
  host: string;
  port: number;
  /** Speak TLS first — `https` in the URL, or the `tls` option. */
  secure: boolean;
  /** Refuse a certificate the runtime does not trust. */
  verify: boolean;
  /** The request path of a WebSocket upgrade. */
  path: string;
  /** The service name a gRPC health check asks about; empty asks for the server. */
  service: string;
}

export type HandshakeOutcome =
  | { connected: true; latencyMs: number; tlsDaysLeft?: number | undefined }
  | { connected: false; reason: string };

const failed = (reason: string): HandshakeOutcome => ({ connected: false, reason });

/** Whole days until a certificate's `valid_to`, or undefined when unreadable. */
function daysUntil(validTo: string | undefined, now: number): number | undefined {
  if (validTo === undefined) return undefined;
  const expiresAt = Date.parse(validTo);
  return Number.isNaN(expiresAt) ? undefined : Math.floor((expiresAt - now) / 86_400_000);
}

/** The SNI name: an IP literal is not a valid one and Node warns when it is sent. */
const serverName = (host: string): string | undefined => (isIP(host) === 0 ? host : undefined);

/** A connected socket — TLS-wrapped when the target is secure — or the reason it is not. */
function open(target: HandshakeTarget, timeoutMs: number): Promise<{ socket: Socket; daysLeft?: number | undefined } | string> {
  return new Promise((resolve) => {
    const base = { host: target.host, port: target.port, timeout: timeoutMs };
    const socket: Socket = target.secure
      ? tlsConnect({ ...base, servername: serverName(target.host), rejectUnauthorized: target.verify })
      : netConnect(base);

    const settle = (result: { socket: Socket; daysLeft?: number | undefined } | string): void => {
      socket.removeAllListeners("error");
      socket.removeAllListeners("timeout");
      if (typeof result === "string") socket.destroy();
      resolve(result);
    };

    socket.once(target.secure ? "secureConnect" : "connect", () => {
      const daysLeft = target.secure
        ? daysUntil((socket as TLSSocket).getPeerCertificate()?.valid_to, Date.now())
        : undefined;
      settle({ socket, daysLeft });
    });
    socket.once("timeout", () => settle("timed out"));
    socket.once("error", (error: Error) => settle(error.message));
  });
}

/** TLS on an arbitrary port, with the days left on the certificate it presented. */
export async function checkTls(target: HandshakeTarget, timeoutMs: number): Promise<HandshakeOutcome> {
  const askedAt = Date.now();
  const opened = await open({ ...target, secure: true }, timeoutMs);
  if (typeof opened === "string") return failed(opened);
  opened.socket.destroy();
  return { connected: true, latencyMs: Date.now() - askedAt, tlsDaysLeft: opened.daysLeft };
}

/**
 * Reads SMTP reply lines until the final one of a reply (`250 ` as opposed to
 * the continuation `250-`), and returns its code and text.
 */
function readReply(socket: Socket, timeoutMs: number): Promise<{ code: number; text: string } | string> {
  return new Promise((resolve) => {
    let buffer = "";
    const done = (result: { code: number; text: string } | string): void => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      clearTimeout(timer);
      resolve(result);
    };
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("latin1");
      const lines = buffer.split(/\r?\n/);
      for (const line of lines) {
        const match = /^(\d{3}) (.*)$/.exec(line);
        if (match !== null) return done({ code: Number(match[1]), text: match[2] ?? "" });
      }
    };
    const onError = (error: Error): void => done(error.message);
    const onClose = (): void => done("connection closed before the reply was complete");
    const timer = setTimeout(() => done("timed out"), timeoutMs);
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

/** A 220 greeting and a 250 to `EHLO`, then `QUIT`. Nothing is ever sent to a mailbox. */
export async function checkSmtp(target: HandshakeTarget, timeoutMs: number): Promise<HandshakeOutcome> {
  const askedAt = Date.now();
  const opened = await open(target, timeoutMs);
  if (typeof opened === "string") return failed(opened);
  const { socket } = opened;
  try {
    const greeting = await readReply(socket, timeoutMs);
    if (typeof greeting === "string") return failed(greeting);
    if (greeting.code !== 220) return failed(`greeted with ${greeting.code} ${greeting.text}, not 220`);

    socket.write("EHLO isitdown.local\r\n");
    const ehlo = await readReply(socket, timeoutMs);
    if (typeof ehlo === "string") return failed(ehlo);
    if (ehlo.code !== 250) return failed(`answered EHLO with ${ehlo.code} ${ehlo.text}, not 250`);

    const latencyMs = Date.now() - askedAt;
    socket.write("QUIT\r\n");
    return { connected: true, latencyMs, tlsDaysLeft: opened.daysLeft };
  } finally {
    socket.destroy();
  }
}

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** An HTTP upgrade to WebSocket: a 101 with the accept token that proves the server read our key. */
export function checkWebSocket(target: HandshakeTarget, timeoutMs: number): Promise<HandshakeOutcome> {
  return new Promise((resolve) => {
    const askedAt = Date.now();
    const key = randomBytes(16).toString("base64");
    const expected = createHash("sha1").update(key + WEBSOCKET_GUID).digest("base64");
    const send = target.secure ? httpsRequest : httpRequest;

    let settled = false;
    const settle = (outcome: HandshakeOutcome): void => {
      if (settled) return;
      settled = true;
      request.destroy();
      resolve(outcome);
    };

    const request = send({
      host: target.host,
      port: target.port,
      path: target.path,
      method: "GET",
      timeout: timeoutMs,
      ...(target.secure ? { servername: serverName(target.host), rejectUnauthorized: target.verify } : {}),
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": key,
      },
    });

    request.once("upgrade", (response, socket) => {
      socket.destroy();
      const accept = response.headers["sec-websocket-accept"];
      if (accept !== expected) return settle(failed("upgraded, but Sec-WebSocket-Accept does not match the key sent"));
      settle({ connected: true, latencyMs: Date.now() - askedAt });
    });
    request.once("response", (response) => {
      response.resume();
      settle(failed(`answered HTTP ${response.statusCode ?? "?"} instead of upgrading to WebSocket`));
    });
    request.once("timeout", () => settle(failed("timed out")));
    request.once("error", (error: Error) => settle(failed(error.message)));
    request.end();
  });
}

/** `grpc.health.v1.HealthCheckResponse.ServingStatus`. */
const SERVING_STATUS = ["UNKNOWN", "SERVING", "NOT_SERVING", "SERVICE_UNKNOWN"] as const;

/** The gRPC length-prefixed frame around a protobuf message. */
const frame = (message: Buffer): Buffer => {
  const header = Buffer.alloc(5);
  header.writeUInt32BE(message.length, 1);
  return Buffer.concat([header, message]);
};

/** `HealthCheckRequest { string service = 1; }`, hand-encoded — one field, no library. */
function encodeHealthRequest(service: string): Buffer {
  if (service === "") return Buffer.alloc(0);
  const name = Buffer.from(service, "utf8");
  // A name over 127 bytes needs a multi-byte varint length; keep the encoder honest.
  const length: number[] = [];
  let remaining = name.length;
  while (remaining > 0x7f) {
    length.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  length.push(remaining);
  return Buffer.concat([Buffer.from([0x0a, ...length]), name]);
}

/** The `status` varint (field 1) of a `HealthCheckResponse`; an absent field is the enum's zero. */
function decodeHealthStatus(body: Buffer): number | null {
  if (body.length < 5) return null;
  const message = body.subarray(5, 5 + body.readUInt32BE(1));
  let index = 0;
  while (index < message.length) {
    const tag = message[index++] ?? 0;
    if (tag === 0x08) return message[index] ?? 0;
    // Skip a field this reader does not know: only varint (0) and length-delimited (2) occur in this message.
    const wire = tag & 0x07;
    if (wire === 0) {
      while (((message[index++] ?? 0) & 0x80) !== 0);
    } else if (wire === 2) {
      index += (message[index] ?? 0) + 1;
    } else {
      return null;
    }
  }
  return 0;
}

/** The standard `grpc.health.v1.Health/Check`, over HTTP/2 — cleartext or TLS as the target says. */
export function checkGrpc(target: HandshakeTarget, timeoutMs: number): Promise<HandshakeOutcome> {
  return new Promise((resolve) => {
    const askedAt = Date.now();
    const session = http2Connect(`${target.secure ? "https" : "http"}://${target.host}:${target.port}`, {
      rejectUnauthorized: target.verify,
    });

    let settled = false;
    const settle = (outcome: HandshakeOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.destroy();
      resolve(outcome);
    };
    const timer = setTimeout(() => settle(failed("timed out")), timeoutMs);
    session.once("error", (error: Error) => settle(failed(error.message)));

    const stream = session.request({
      ":method": "POST",
      ":path": "/grpc.health.v1.Health/Check",
      "content-type": "application/grpc",
      te: "trailers",
    });

    let grpcStatus: string | undefined;
    let grpcMessage: string | undefined;
    const readStatus = (headers: Record<string, unknown>): void => {
      if (typeof headers["grpc-status"] === "string") grpcStatus = headers["grpc-status"];
      if (typeof headers["grpc-message"] === "string") grpcMessage = headers["grpc-message"];
    };
    stream.on("response", readStatus);
    stream.on("trailers", readStatus);

    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.once("error", (error: Error) => settle(failed(error.message)));
    stream.once("end", () => {
      if (grpcStatus === undefined) return settle(failed("answered without a grpc-status"));
      if (grpcStatus !== "0") {
        return settle(failed(`grpc-status ${grpcStatus}${grpcMessage === undefined ? "" : `: ${decodeURIComponent(grpcMessage)}`}`));
      }
      const status = decodeHealthStatus(Buffer.concat(chunks));
      if (status === null) return settle(failed("answered a health check with a message that is not one"));
      if (status !== 1) return settle(failed(`health status ${SERVING_STATUS[status] ?? status}, not SERVING`));
      settle({ connected: true, latencyMs: Date.now() - askedAt });
    });

    stream.end(frame(encodeHealthRequest(target.service)));
  });
}
