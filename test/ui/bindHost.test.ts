import { test } from "node:test";
import assert from "node:assert/strict";
import { readBindHost } from "../../src/ui/bindHost.ts";

test("readBindHost defaults to loopback when BIND_HOST is unset", () => {
  assert.equal(readBindHost({}), "127.0.0.1");
});

test("readBindHost defaults to loopback when BIND_HOST is empty", () => {
  assert.equal(readBindHost({ BIND_HOST: "" }), "127.0.0.1");
});

test("readBindHost defaults to loopback when BIND_HOST is only whitespace", () => {
  assert.equal(readBindHost({ BIND_HOST: "  " }), "127.0.0.1");
});

test("readBindHost returns an explicit IPv4 wildcard as given", () => {
  assert.equal(readBindHost({ BIND_HOST: "0.0.0.0" }), "0.0.0.0");
});

test("readBindHost returns an explicit IPv6 wildcard as given", () => {
  assert.equal(readBindHost({ BIND_HOST: "::" }), "::");
});
