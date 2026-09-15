import { createSocket, type Socket } from "node:dgram";
import type { AddressInfo } from "node:net";

/**
 * A minimal local DNS server, so the DNS probe (roadmap 1.9) can be tested
 * against real wire-format answers without ever asking a real resolver. It
 * understands exactly as much of RFC 1035 as the adapter's tests need: one
 * question per query, A and TXT answers, an RCODE for the failure cases, and
 * silence for the timeout one.
 */

export type DnsReply =
  | { kind: "a"; addresses: string[] }
  | { kind: "txt"; values: string[] }
  /** Any RCODE: 3 is NXDOMAIN, 2 is SERVFAIL, 0 with no records is NOANSWER. */
  | { kind: "rcode"; rcode: number }
  /** Answer nothing at all, so the caller's own deadline is what ends it. */
  | { kind: "silence" };

/**
 * Runs `run` against a resolver address in the `ip:port` form
 * `Resolver.setServers` takes. The reply is fixed for the life of the server:
 * each test asks one question.
 */
export async function withDnsServer(
  reply: DnsReply,
  run: (resolverAddress: string, server: Socket) => Promise<void>,
): Promise<void> {
  const server = createSocket("udp4");

  server.on("message", (query, remote) => {
    if (reply.kind === "silence") return;
    const answer = buildAnswer(query, reply);
    if (answer !== null) server.send(answer, remote.port, remote.address);
  });

  await new Promise<void>((resolve) => server.bind(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`127.0.0.1:${port}`, server);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** Where the question section ends: labels to the root, then QTYPE and QCLASS. */
function questionEnd(query: Buffer): number | null {
  let offset = 12;
  while (offset < query.length) {
    const length = query[offset];
    if (length === undefined) return null;
    if (length === 0) return offset + 5;
    offset += length + 1;
  }
  return null;
}

function buildAnswer(query: Buffer, reply: DnsReply): Buffer | null {
  const end = questionEnd(query);
  if (end === null || end > query.length) return null;

  const records = reply.kind === "a" ? reply.addresses.map(aRecord) : reply.kind === "txt" ? reply.values.map(txtRecord) : [];

  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 2); // the query's own id, which the resolver matches on
  // QR=1 (a response), RD copied from the query, RA=1 (recursion available),
  // plus the RCODE in the low nibble of the second flags byte.
  header[2] = 0x80 | (query[2]! & 0x01);
  header[3] = 0x80 | (reply.kind === "rcode" ? reply.rcode & 0x0f : 0);
  header.writeUInt16BE(1, 4); // QDCOUNT
  header.writeUInt16BE(records.length, 6); // ANCOUNT

  return Buffer.concat([header, query.subarray(12, end), ...records]);
}

/** A record body, with the name written as a pointer back to the question. */
function record(type: number, rdata: Buffer): Buffer {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(0xc00c, 0); // compression pointer to offset 12: the question's name
  head.writeUInt16BE(type, 2);
  head.writeUInt16BE(1, 4); // class IN
  head.writeUInt32BE(60, 6); // TTL
  head.writeUInt16BE(rdata.length, 10);
  return Buffer.concat([head, rdata]);
}

const aRecord = (address: string): Buffer =>
  record(1, Buffer.from(address.split(".").map((part) => Number(part))));

const txtRecord = (value: string): Buffer => {
  const bytes = Buffer.from(value, "utf8");
  return record(16, Buffer.concat([Buffer.from([bytes.length]), bytes]));
};
