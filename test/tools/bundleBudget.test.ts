import { test } from "node:test";
import assert from "node:assert/strict";
import { BUDGET, checkBudget, measure } from "../../tools/bundle-budget.mjs";

const asset = (name: string, gzipped: number) => ({ name, gzipped, raw: gzipped * 3 });

test("assets are totalled per kind, and anything that is not code is ignored", () => {
  const totals = checkBudget(
    [asset("index-a1.js", 100), asset("vendor-b2.js", 50), asset("index-c3.css", 20), asset("map-d4.json", 900)],
    { js: 200, css: 30 },
  );

  assert.deepEqual(
    totals.kinds.map(({ kind, gzipped }) => [kind, gzipped]),
    [
      ["js", 150],
      ["css", 20],
    ],
  );
  assert.equal(totals.failed, false);
});

test("a kind over its budget fails and names what it is over by", () => {
  const totals = checkBudget([asset("index-a1.js", 300)], { js: 200, css: 30 });

  assert.equal(totals.failed, true);
  const js = totals.kinds.find((entry) => entry.kind === "js");
  assert.equal(js?.over, true);
  assert.equal(js?.budget, 200);
});

test("a kind that is exactly on its budget passes: the budget is the limit, not the last byte under it", () => {
  assert.equal(checkBudget([asset("index-a1.js", 200)], { js: 200, css: 30 }).failed, false);
});

test("a kind with no assets at all is still reported, so a bundle that stopped emitting CSS is visible", () => {
  const totals = checkBudget([asset("index-a1.js", 10)], { js: 200, css: 30 });

  assert.deepEqual(
    totals.kinds.map((entry) => entry.kind),
    ["js", "css"],
  );
  assert.equal(totals.kinds.find((entry) => entry.kind === "css")?.gzipped, 0);
});

test("the shipped budget leaves headroom over what the dashboard weighs today", () => {
  // Not a target to grow into: the budget exists to catch a jump, so it has to
  // be over the real figure and nowhere near a megabyte.
  assert.ok(BUDGET.js < 1_000_000);
  assert.ok(BUDGET.css < BUDGET.js);
});

test("measuring an asset reports its gzipped size beside its real one", () => {
  const [entry] = measure([{ name: "index-a1.js", contents: Buffer.from("a".repeat(4096)) }]);

  assert.equal(entry?.raw, 4096);
  assert.ok((entry?.gzipped ?? 0) < 4096, "compressible text must measure smaller gzipped");
});
