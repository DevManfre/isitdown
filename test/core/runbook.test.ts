import { test } from "node:test";
import assert from "node:assert/strict";
import { runbookHint } from "../../src/core/runbook.ts";

// Roadmap 5.1: a message quotes where to start, never the whole Markdown.
test("a runbook's first link is what a message quotes", () => {
  assert.equal(
    runbookHint("## If GitHub is down\n\nSee https://wiki.example.com/runbooks/github. Then call ops."),
    "https://wiki.example.com/runbooks/github",
  );
});

test("with no link, its first line, stripped of Markdown", () => {
  assert.equal(runbookHint("\n## Switch CI to the **EU** mirror\n- then tell #dev"), "Switch CI to the EU mirror");
  assert.equal(runbookHint("1. Fail over to the secondary"), "Fail over to the secondary");
});

test("a long first line is cut, and nothing yields nothing", () => {
  const hint = runbookHint("x".repeat(500));
  assert.equal(hint?.length, 140);
  assert.ok(hint?.endsWith("…"));
  assert.equal(runbookHint(undefined), null);
  assert.equal(runbookHint("#  \n\n"), null);
});
