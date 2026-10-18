#!/usr/bin/env node
// PreToolUse(Bash): CLAUDE.md forbids rewriting every visual baseline at once.
import { readFileSync } from "node:fs";

const cmd = JSON.parse(readFileSync(0, "utf8")).tool_input?.command ?? "";
const visual = /visual-regression\.mjs|test:visual/.test(cmd);
if (visual && /--update\b/.test(cmd) && !/--only=/.test(cmd)) {
  process.stderr.write(
    "Blocked: --update without --only rewrites all visual baselines, including views you never touched. " +
    "Agree one view at a time: node tools/visual-regression.mjs --only=<view> --update, and Read each frame first (CLAUDE.md › The visual baselines).",
  );
  process.exit(2);
}
