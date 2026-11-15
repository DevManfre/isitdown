import { test } from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:tls";
import { tlsServerName } from "../../src/core/tlsServerName.ts";

test("a hostname is sent as the SNI name", () => {
  assert.equal(tlsServerName("status.example.com"), "status.example.com");
});

test("an IP literal, v4 or v6, bracketed or not, sends no SNI name at all", () => {
  for (const host of ["127.0.0.1", "::1", "[::1]", "2001:db8::1"]) {
    assert.equal(tlsServerName(host), undefined, host);
  }
});

test("Node accepts what it returns for an IP host, where the raw IP is refused", () => {
  // Node 26 turned DEP0123 into a throw: tls.connect({ servername: "<ip>" })
  // no longer warns, it fails before a byte is sent.
  assert.throws(() => connect({ host: "127.0.0.1", port: 1, servername: "127.0.0.1" }).destroy(), {
    code: "ERR_INVALID_ARG_VALUE",
  });
  const socket = connect({ host: "127.0.0.1", port: 1, servername: tlsServerName("127.0.0.1") });
  socket.on("error", () => {});
  socket.destroy();
});
