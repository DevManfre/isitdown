import { test } from "node:test";
import assert from "node:assert/strict";
import { renderChangelog } from "../../tools/changelog.mjs";

test("one section per release, in the order given, each grouped by TITLE", () => {
  const changelog = renderChangelog([
    { version: "v1.1.0", date: "2026-02-01", subjects: ["✨ UI - add a chart", "🐛 POLLER - fix backoff"] },
    { version: "v1.0.0", date: "2026-01-01", subjects: ["🎉 INIT - start the project"] },
  ]);

  const body = changelog.slice(changelog.indexOf("## "));
  assert.equal(
    body,
    [
      "## v1.1.0 — 2026-02-01",
      "",
      "### UI",
      "",
      "- ✨ add a chart",
      "",
      "### POLLER",
      "",
      "- 🐛 fix backoff",
      "",
      "## v1.0.0 — 2026-01-01",
      "",
      "### INIT",
      "",
      "- 🎉 start the project",
      "",
    ].join("\n"),
  );
});

test("the file says it is generated, so nobody edits it by hand", () => {
  assert.match(renderChangelog([]), /^# Changelog\n[\s\S]*tools\/changelog\.mjs/);
});

test("a release with no commits still gets its heading and a placeholder", () => {
  const changelog = renderChangelog([{ version: "v2.0.1", date: "2026-03-01", subjects: [] }]);

  assert.match(changelog, /## v2\.0\.1 — 2026-03-01\n\nNo commits in this release\.\n$/);
});
