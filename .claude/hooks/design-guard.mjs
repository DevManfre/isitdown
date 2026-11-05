#!/usr/bin/env node
// PreToolUse(Edit|Write): refuse a dashboard edit that adds something the
// dashboard-design-direction skill rules out — text below 12px, a decorative
// Magic UI effect, or a second animation library. Checks only the text being
// written, so untouched legacy lines don't block unrelated edits.
// `// design-ignore` (or `/* design-ignore */`) on the line opts out.
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const ti = input.tool_input ?? {};
const file = ti.file_path ?? "";
if (!/\/src\/ui\/web\/.*\.(tsx|ts|css)$/.test(file)) process.exit(0);
if (/\.test\.tsx?$/.test(file) || file.includes("/node_modules/")) process.exit(0);

const text = ti.new_string ?? ti.content ?? "";
// A file that already imports motion/react (edit mode's drag and layout
// animation, the NumberTicker spring) keeps it; only a new importer is refused.
let onDisk = "";
try { onDisk = readFileSync(file, "utf8"); } catch {}
const motionAllowed = /from\s+["']motion\/react["']/.test(onDisk);
const RULES = [
  [/\btext-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/, "text below 12px (use text-xs at the smallest)"],
  [/\btext-\[0?\.(?:[0-6]\d*|7[0-4]\d*)r?em\]/, "text below 12px (0.75rem; use text-xs at the smallest)"],
  [/\bfont-size:\s*(?:[0-9]|1[01])(?:\.\d+)?px/, "font-size below 12px"],
  [/\bfontSize[=:]\s*\{?\s*(?:[0-9]|1[01])\b/, "chart label below 12px"],
  [/from\s+["'][^"']*\/ui\/(border-beam|typing-animation|spotlight-card|dot-pattern)(\.tsx)?["']/, "decorative Magic UI effect"],
  [/from\s+["'](framer-motion|motion\/react|motion)["']/, "second animation system (use css/motion.css)"],
];
const hits = [];
for (const line of text.split("\n")) {
  if (/design-ignore/.test(line)) continue;
  for (const [re, why] of RULES) {
    if (motionAllowed && why.startsWith("second animation")) continue;
    const m = line.match(re);
    if (m) hits.push(`${why}: ${JSON.stringify(m[0])}`);
  }
}
if (hits.length) {
  process.stderr.write(
    `design guard: ${file}\n  - ${hits.join("\n  - ")}\n` +
    `See .claude/skills/dashboard-design-direction/SKILL.md. ` +
    `If this is a deliberate, agreed exception, add a design-ignore comment on that line.`,
  );
  process.exit(2);
}
