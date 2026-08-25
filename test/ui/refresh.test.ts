import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldHoldRefresh } from "../../src/ui/web/lib/holdRefresh.ts";

const page = (over: Partial<Parameters<typeof shouldHoldRefresh>[0]> = {}) => ({
  hidden: false, dialogOpen: false, editing: false, ...over,
});

test("an idle visible page may refresh", () => {
  assert.equal(shouldHoldRefresh(page()), false);
});

test("a hidden tab holds: it has nothing to show", () => {
  assert.equal(shouldHoldRefresh(page({ hidden: true })), true);
});

test("an open dialog holds: a repaint would discard what is being edited", () => {
  assert.equal(shouldHoldRefresh(page({ dialogOpen: true })), true);
});

test("a focused field holds, for the same reason", () => {
  assert.equal(shouldHoldRefresh(page({ editing: true })), true);
});
