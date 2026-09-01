import { test } from "node:test";
import assert from "node:assert/strict";
import { groupCommits, renderNotes } from "../../tools/release-notes.mjs";

test("commits are grouped by their TITLE, in first-seen order", () => {
  const groups = groupCommits([
    "🐛 POLLER - fix retry backoff resetting on every failure",
    "✨ UI - add an uptime chart",
    "♻️ POLLER - extract the backoff helper",
  ]);

  assert.deepEqual(
    groups.map((group) => group.title),
    ["POLLER", "UI"],
  );
  assert.deepEqual(groups[0]?.entries, [
    { emoji: "🐛", description: "fix retry backoff resetting on every failure" },
    { emoji: "♻️", description: "extract the backoff helper" },
  ]);
});

test("a subject that does not follow the convention lands in Other, verbatim", () => {
  const groups = groupCommits(["Merge branch 'dev'", "🐛 UI - fix a thing"]);

  const other = groups.find((group) => group.title === "Other");
  assert.deepEqual(other?.entries, [{ emoji: "", description: "Merge branch 'dev'" }]);
});

test("a multi-word title and a description containing a dash both survive", () => {
  const [group] = groupCommits(["📝 DIFF ENGINE - document the state-transition table"]);

  assert.equal(group?.title, "DIFF ENGINE");
  assert.deepEqual(group?.entries, [{ emoji: "📝", description: "document the state-transition table" }]);
});

test("empty history renders a placeholder rather than an empty document", () => {
  assert.match(renderNotes([]), /No commits/);
});

test("notes render one section per title and one bullet per commit", () => {
  const notes = renderNotes(groupCommits(["🐛 POLLER - fix backoff", "✨ UI - add a chart"]));

  assert.equal(
    notes,
    ["### POLLER", "", "- 🐛 fix backoff", "", "### UI", "", "- ✨ add a chart", ""].join("\n"),
  );
});
