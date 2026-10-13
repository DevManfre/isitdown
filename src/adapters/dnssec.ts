import { createSocket } from "node:dgram";
import { randomInt } from "node:crypto";
import { isIPv6 } from "node:net";

/**
 * Whether a validating resolver vouches for a name's DNSSEC chain — roadmap
 * 2.7.
 *
 * Node's resolver hides the one bit that answers it — AD, "authenticated data"
 * — so this sends the query itself: a single UDP packet asking with the DO bit
 * set (EDNS0, "I understand DNSSEC"), read back only as far as the header. A
 * validating resolver sets AD when the chain checks out, answers SERVFAIL when
 * it is broken, and does neither for a zone that is simply unsigned. SERVFAIL
 * alone could be the resolver's own bad day, so it is asked once more with CD
 * ("checking disabled"): if the name resolves when validation is off, the
 * signatures are what failed.
 *
 * The resolver must validate — 1.1.1.1, 9.9.9.9, 8.8.8.8 do; a zone's own
 * authoritative server never sets AD.
 */

export type DnssecVerdict =
  /** The chain validated. */
  | { kind: "secure" }
  /** Resolved, but nothing vouched for it: unsigned, or a resolver that does not validate. */
  | { kind: "insecure" }
  /** Signatures present and failing: validating resolvers refuse the name. */
  | { kind: "bogus" }
  /** No usable answer at all; `reason` says why. */
  | { kind: "error"; reason: string };

export const RECORD_TYPE_CODES: Record<string, number> = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28 };

const FLAG_QR = 0x8000;
const FLAG_RD = 0x0100;
const FLAG_AD = 0x0020;
const FLAG_CD = 0x0010;
const RCODE_SERVFAIL = 2;

/** One query: `name`/`type`, recursion desired, EDNS0 with DO set. */
export function buildQuery(id: number, name: string, type: number, checkingDisabled: boolean): Buffer {
  const labels = name.replace(/\.$/, "").split(".").filter((label) => label !== "");
  const qname = Buffer.concat([
    ...labels.map((label) => {
      const bytes = Buffer.from(label, "ascii");
      if (bytes.length > 63) throw new Error(`label "${label}" is longer than 63 bytes`);
      return Buffer.concat([Buffer.from([bytes.length]), bytes]);
    }),
    Buffer.from([0]),
  ]);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  // AD in a query asks the resolver to report it (RFC 6840 §5.7).
  header.writeUInt16BE(FLAG_RD | FLAG_AD | (checkingDisabled ? FLAG_CD : 0), 2);
  header.writeUInt16BE(1, 4); // QDCOUNT
  header.writeUInt16BE(1, 10); // ARCOUNT: the OPT record
  const question = Buffer.alloc(4);
  question.writeUInt16BE(type, 0);
  question.writeUInt16BE(1, 2); // class IN
  // OPT: root name, type 41, class = UDP payload size, TTL carries the DO bit.
  const opt = Buffer.from([0, 0, 41, 0x04, 0xd0, 0, 0, 0x80, 0, 0, 0]);
  return Buffer.concat([header, qname, question, opt]);
}

/** The header of an answer to query `id`: whether AD is set, and the RCODE. */
export function parseHeader(packet: Buffer, id: number): { ad: boolean; rcode: number } | null {
  if (packet.length < 12 || packet.readUInt16BE(0) !== id) return null;
  const flags = packet.readUInt16BE(2);
  if ((flags & FLAG_QR) === 0) return null;
  return { ad: (flags & FLAG_AD) !== 0, rcode: flags & 0x000f };
}

/** `1.1.1.1`, `127.0.0.1:5353`, `[2606:4700::1111]:53` → host and port. */
export function resolverAddress(resolver: string): { host: string; port: number } {
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(resolver);
  if (bracketed !== null) return { host: bracketed[1]!, port: Number(bracketed[2] ?? 53) };
  if (isIPv6(resolver)) return { host: resolver, port: 53 };
  const [host = resolver, port] = resolver.split(":");
  return { host, port: port === undefined ? 53 : Number(port) };
}

function ask(packet: Buffer, id: number, resolver: string, timeoutMs: number): Promise<{ ad: boolean; rcode: number }> {
  const { host, port } = resolverAddress(resolver);
  const socket = createSocket(isIPv6(host) ? "udp6" : "udp4");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`${resolver} did not answer`)), timeoutMs);
    const finish = (error: Error | null, header?: { ad: boolean; rcode: number }): void => {
      clearTimeout(timer);
      socket.close();
      if (error !== null) reject(error);
      else resolve(header!);
    };
    socket.on("message", (message) => {
      const header = parseHeader(message, id);
      // Not ours (or not an answer): keep waiting for the one that is.
      if (header !== null) finish(null, header);
    });
    socket.on("error", (error) => finish(error));
    socket.send(packet, port, host, (error) => {
      if (error) finish(error);
    });
  });
}

/** Asks `resolver` about `name`/`type` and says what the answer means for DNSSEC. Never rejects. */
export async function checkDnssec(name: string, type: string, resolver: string, timeoutMs: number): Promise<DnssecVerdict> {
  const code = RECORD_TYPE_CODES[type] ?? RECORD_TYPE_CODES["A"]!;
  try {
    const id = randomInt(0, 0x10000);
    const header = await ask(buildQuery(id, name, code, false), id, resolver, timeoutMs);
    if (header.rcode === RCODE_SERVFAIL) {
      const retryId = randomInt(0, 0x10000);
      const unchecked = await ask(buildQuery(retryId, name, code, true), retryId, resolver, timeoutMs);
      return unchecked.rcode === 0 ? { kind: "bogus" } : { kind: "error", reason: "SERVFAIL with validation on and off" };
    }
    if (header.rcode === 3) return { kind: "error", reason: "NXDOMAIN" };
    if (header.rcode !== 0) return { kind: "error", reason: `RCODE ${header.rcode}` };
    return header.ad ? { kind: "secure" } : { kind: "insecure" };
  } catch (error) {
    return { kind: "error", reason: error instanceof Error ? error.message : String(error) };
  }
}
