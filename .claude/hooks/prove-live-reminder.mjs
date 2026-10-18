#!/usr/bin/env node
// Stop: if the working tree has dashboard changes newer than the served bundle,
// remind Claude of CLAUDE.md's three-rung "prove it live" check — once per stop.
import { execSync } from "node:child_process";
import { readFileSync, statSync, existsSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
if (input.stop_hook_active) process.exit(0);
const root = input.cwd ?? process.cwd();
let changed = [];
try {
  changed = execSync("git status --porcelain -- src/ui", { cwd: root, encoding: "utf8" })
    .split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
} catch { process.exit(0); }
if (!changed.length) process.exit(0);

// The newest of the local bundle and the running container: a container
// redeploy builds from the source tree, so it ships the edit without ever
// touching dist/ui/public on the host.
const bundle = `${root}/dist/ui/public/index.html`;
let builtAt = existsSync(bundle) ? statSync(bundle).mtimeMs : 0;
try {
  const created = execSync("docker inspect -f '{{.Created}}' isitdown-ui", { encoding: "utf8", stdio: "pipe" }).trim();
  builtAt = Math.max(builtAt, Date.parse(created) || 0);
} catch {}
const newest = Math.max(...changed.map((f) => { try { return statSync(`${root}/${f}`).mtimeMs; } catch { return 0; } }));
if (newest <= builtAt) process.exit(0);

let devMode = false;
try { devMode = /isitdown:dev/.test(execSync("docker inspect -f '{{.Config.Image}}' isitdown-ui", { encoding: "utf8", stdio: "pipe" })); } catch {}
if (devMode) process.exit(0);

process.stdout.write(JSON.stringify({
  decision: "block",
  reason:
    "src/ui has edits newer than dist/ui/public. Per CLAUDE.md › Every change ships to the running instance: redeploy the way it runs " +
    "(docker compose --profile ui up -d --build, or npm run build:ui + restart), then prove it live — rung 1 asset 200, rung 2 your string in the bundle, " +
    "rung 3 a Playwright screenshot you Read. If this turn deliberately left the change undeployed, say so to the user and stop.",
}));
