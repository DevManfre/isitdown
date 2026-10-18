#!/usr/bin/env node
// PostToolUse(Edit|Write): after a dashboard edit, typecheck the web tree and
// run the Vitest files that import the edited one. Failures go back to Claude.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const file = input.tool_input?.file_path ?? "";
if (!/\/src\/ui\/web\/.*\.(tsx?|json)$/.test(file) || file.includes("node_modules")) process.exit(0);

const root = input.cwd ?? process.cwd();
const run = (cmd) => {
  try { execSync(cmd, { cwd: root, stdio: "pipe", encoding: "utf8" }); return null; }
  catch (e) { return ((e.stdout ?? "") + (e.stderr ?? "")).split("\n").slice(-40).join("\n"); }
};

const problems = [];
const tsc = run("npx tsc -p tsconfig.web.json --noEmit");
if (tsc) problems.push(`typecheck (tsconfig.web.json) failed:\n${tsc}`);
if (/\.tsx?$/.test(file)) {
  const vt = run(`npx vitest related ${JSON.stringify(file)} --run --passWithNoTests`);
  if (vt) problems.push(`vitest related ${file} failed:\n${vt}`);
}
if (problems.length) {
  process.stderr.write(problems.join("\n\n"));
  process.exit(2);
}
