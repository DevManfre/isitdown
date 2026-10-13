import { test } from "node:test";
import assert from "node:assert/strict";
import { createSocket, type Socket } from "node:dgram";
import type { AddressInfo } from "node:net";
import { buildQuery, checkDnssec, parseHeader, resolverAddress } from "../../src/adapters/dnssec.ts";

/**
 * Roadmap 2.7: DNSSEC read off the AD bit of a hand-built query. The resolver
 * here is a fake one on the loopback that answers each query with the flags a
 * test chose, so every verdict is reached without a network.
 */

test("the query asks recursively, with AD and EDNS0's DO bit", () => {
  const packet = buildQuery(0xbeef, "example.com", 1, false);
  assert.equal(packet.readUInt16BE(0), 0xbeef);
  assert.equal(packet.readUInt16BE(2), 0x0120, "RD and AD, no CD");
  assert.equal(packet.readUInt16BE(4), 1, "one question");
  assert.equal(packet.readUInt16BE(10), 1, "one additional record: OPT");
  // 7example3com0, then type A class IN.
  assert.deepEqual([...packet.subarray(12, 25)], [7, ...Buffer.from("example"), 3, ...Buffer.from("com"), 0]);
  assert.equal(packet.readUInt16BE(25), 1);
  assert.equal(packet.readUInt16BE(27), 1);
  // The OPT record: root, type 41, DO set in the TTL's flag half.
  const opt = packet.subarray(29);
  assert.equal(opt.readUInt16BE(1), 41);
  assert.equal(opt.readUInt16BE(7), 0x8000);
  assert.equal(buildQuery(1, "example.com", 1, true).readUInt16BE(2), 0x0130, "CD added on request");
  assert.throws(() => buildQuery(1, `${"a".repeat(64)}.com`, 1, false), /longer than 63/);
});

test("only an answer to our own query is read", () => {
  const answer = Buffer.alloc(12);
  answer.writeUInt16BE(7, 0);
  answer.writeUInt16BE(0x81a0, 2); // QR, RD, RA, AD
  assert.deepEqual(parseHeader(answer, 7), { ad: true, rcode: 0 });
  assert.equal(parseHeader(answer, 8), null, "someone else's id");
  answer.writeUInt16BE(0x0100, 2);
  assert.equal(parseHeader(answer, 7), null, "a query, not an answer");
  assert.equal(parseHeader(Buffer.alloc(4), 7), null);
});

test("resolver addresses take an optional port, IPv6 in brackets", () => {
  assert.deepEqual(resolverAddress("1.1.1.1"), { host: "1.1.1.1", port: 53 });
  assert.deepEqual(resolverAddress("127.0.0.1:5353"), { host: "127.0.0.1", port: 5353 });
  assert.deepEqual(resolverAddress("[2606:4700::1111]:53"), { host: "2606:4700::1111", port: 53 });
  assert.deepEqual(resolverAddress("2606:4700::1111"), { host: "2606:4700::1111", port: 53 });
});

/** A resolver that answers each query with `answer(cd)`'s flags, or not at all. */
async function fakeResolver(answer: (checkingDisabled: boolean) => number | null): Promise<{ socket: Socket; address: string }> {
  const socket = createSocket("udp4");
  socket.on("message", (query, peer) => {
    const flags = answer((query.readUInt16BE(2) & 0x0010) !== 0);
    if (flags === null) return;
    const reply = Buffer.from(query);
    reply.writeUInt16BE(0x8000 | 0x0100 | 0x0080 | flags, 2);
    socket.send(reply, peer.port, peer.address);
  });
  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", () => resolve()));
  return { socket, address: `127.0.0.1:${(socket.address() as AddressInfo).port}` };
}

test("each answer means what a validating resolver means by it", async () => {
  const cases: [string, (cd: boolean) => number | null, string][] = [
    ["AD set", () => 0x0020, "secure"],
    ["no AD", () => 0, "insecure"],
    ["SERVFAIL only while validating", (cd) => (cd ? 0 : 2), "bogus"],
    ["SERVFAIL either way", () => 2, "error"],
    ["NXDOMAIN", () => 3, "error"],
    ["no answer", () => null, "error"],
  ];
  for (const [label, answer, kind] of cases) {
    const { socket, address } = await fakeResolver(answer);
    try {
      const verdict = await checkDnssec("example.com", "A", address, 300);
      assert.equal(verdict.kind, kind, label);
    } finally {
      socket.close();
    }
  }
});
