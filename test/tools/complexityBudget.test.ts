import { test } from "node:test";
import assert from "node:assert/strict";
import { BUDGET, checkBudget, measure, render } from "../../tools/complexity-budget.mjs";

const budget = { configKeys: 10, adapters: 3 };

test("a measure at its ceiling passes: the ceiling is the limit, not the last value under it", () => {
  const { over } = checkBudget({ configKeys: 10, adapters: 3 }, budget);
  assert.deepEqual(over, []);
});

test("a measure over its ceiling is named, with how far over it is", () => {
  const { over } = checkBudget({ configKeys: 12, adapters: 3 }, budget);
  assert.deepEqual(
    over.map(({ key, value, ceiling }) => [key, value, ceiling]),
    [["configKeys", 12, 10]],
  );
});

test("a measure under its ceiling passes, so a removal leaves room for one later addition", () => {
  assert.deepEqual(checkBudget({ configKeys: 4, adapters: 1 }, budget).over, []);
});

test("every budgeted measure gets a row in the summary, the over ones marked", () => {
  const markdown = render(checkBudget({ configKeys: 12, adapters: 3 }, budget));
  assert.match(markdown, /\| config\.yml keys \| 12 \| 10 \| \*\*over\*\* \|/);
  assert.match(markdown, /\| Adapters \| 3 \| 3 \| ok \|/);
});

// No test asserts today's tree is within budget: that would turn the warning
// into a failure, and the budget only warns (roadmap 16.5).
test("every measure taken from the tree has a ceiling, and counts something", async () => {
  const figures = await measure();
  assert.deepEqual(Object.keys(figures).sort(), Object.keys(BUDGET).sort());
  for (const [key, value] of Object.entries(figures)) assert.ok(value > 0, `${key} measured ${value}`);
});
