#!/usr/bin/env node
// PreToolUse(Edit|Write): refuse a dashboard edit that adds a user-facing
// literal in JSX text or in a label-like prop instead of a t() key.
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const ti = input.tool_input ?? {};
const file = ti.file_path ?? "";
if (!/\/src\/ui\/web\/(views|components)\/.*\.tsx$/.test(file)) process.exit(0);
if (/\.test\.tsx$/.test(file) || file.includes("/components/ui/")) process.exit(0);

const text = ti.new_string ?? ti.content ?? "";
const hits = [];
for (const line of text.split("\n")) {
  if (/^\s*(\/\/|\*|\/\*)/.test(line) || line.includes("i18n-ignore")) continue;
  // >Some words< between tags
  const jsx = line.match(/>\s*([A-Z][a-z]+(?:[ ,'][A-Za-z]+)+[.!?]?)\s*</);
  // aria-label="Words" / title="Words" / placeholder="Words" / alt="Words"
  const prop = line.match(/\b(aria-label|title|placeholder|alt|label)="([A-Z][a-z]+[^"]*)"/);
  if (jsx) hits.push(jsx[1]);
  if (prop) hits.push(`${prop[1]}="${prop[2]}"`);
}
if (hits.length) {
  process.stderr.write(
    `i18n guard: user-facing literal(s) in ${file}: ${hits.map((h) => JSON.stringify(h)).join(", ")}.\n` +
    `Put the English string in src/ui/web/locales/en.json (and translate the other catalogs) and render it with t() — see the i18n-strings skill. ` +
    `If it is genuinely not user-facing, add an // i18n-ignore comment on that line.`,
  );
  process.exit(2);
}
