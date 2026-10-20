import { test } from "node:test";
import assert from "node:assert/strict";
import { fitText, publicParts } from "../../src/notifiers/formatting.ts";
import { opened } from "./contract/fixtures.ts";

test("a text inside the limit comes back untouched", () => {
  assert.equal(fitText("GitHub — major outage", 100), "GitHub — major outage");
  assert.equal(fitText("exactly", 7), "exactly");
});

test("a text past the limit is cut and says so with an ellipsis", () => {
  const cut = fitText("abcdefghij", 6);
  assert.equal(cut, "abcde…");
  assert.equal(cut.length, 6);
});

test("the cut drops trailing whitespace before the ellipsis", () => {
  assert.equal(fitText("abc   defghij", 7), "abc…");
});

test("a cut in characters never splits an emoji's surrogate pair", () => {
  const cut = fitText("ab🔥🔥🔥", 5);
  assert.ok(cut.length <= 5);
  assert.equal(cut, "ab🔥…");
  assert.ok(!/[\uD800-\uDBFF]…$/.test(cut), "a lone high surrogate before the ellipsis");
});

test("a cut in bytes counts UTF-8 and never splits a multi-byte character", () => {
  const cut = fitText("ééééé", 7, "bytes");
  assert.ok(Buffer.byteLength(cut) <= 7);
  // The ellipsis is three bytes, so two two-byte letters fit beside it.
  assert.equal(cut, "éé…");
});

test("a cut in graphemes keeps a composed emoji whole", () => {
  const family = "👨‍👩‍👧";
  const cut = fitText(`${family}${family}${family}`, 2, "graphemes");
  assert.equal(cut, `${family}…`);
});

test("public parts drop the operator's impact and owner notes", () => {
  const withNotes = { ...opened, service: { ...opened.service, impact: "Checkout breaks", owner: "Maria, +39 333" } };
  const { detail } = publicParts(withNotes);
  assert.ok(!detail.includes("Maria"));
  assert.ok(!detail.includes("Checkout breaks"));
  assert.ok(detail.includes("API requests failing"));
});
