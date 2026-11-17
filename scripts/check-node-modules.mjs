#!/usr/bin/env node
// Whether node_modules holds exactly what package-lock.json pins — the same
// tree CI's `npm ci` installs. Run by the pre-push hook before the visual
// check, which compares renders and so fails confusingly on a library version
// CI never runs (ALE-230: recharts 3.8.0 locally against the lockfile's
// 3.10.1). Exact versions, not ranges: `npm ls` passes 3.8.0 for `^3`.
//
// Lists every package whose installed version differs, and exits 1 if any.
import { existsSync, readFileSync } from "node:fs";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const stale = [];
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  // The root project, and packages npm skipped for this platform or as optional.
  if (path === "" || entry.version === undefined || entry.optional) continue;
  const manifest = `${path}/package.json`;
  const installed = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")).version : "missing";
  if (installed !== entry.version) stale.push(`${path.replace(/^node_modules\//, "")}: ${installed}, lockfile ${entry.version}`);
}
for (const line of stale.slice(0, 10)) process.stderr.write(`  ${line}\n`);
if (stale.length > 10) process.stderr.write(`  … and ${stale.length - 10} more\n`);
process.exit(stale.length === 0 ? 0 : 1);
