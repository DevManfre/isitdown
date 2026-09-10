// Bundle-size budget — roadmap 5.16.
//
// The dashboard carries Recharts, motion, cobe, dotted-map and a year calendar,
// and every one of them arrived for a good reason. What no single reason
// covers is the total: a bundle grows a few kilobytes at a time until the local
// dashboard of a three-dependency project takes a second to load on a Raspberry
// Pi. This is the check that makes that visible, in CI, at the moment it
// happens rather than a year later.
//
// Measured gzipped, because that is what the browser downloads. The budgets are
// a ceiling with headroom over today's build, not a target to grow into.
//
// CLI: node tools/bundle-budget.mjs [dist/ui/public/assets]
import { readdir, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const ASSETS = "dist/ui/public/assets";

/** Gzipped bytes per kind. Roughly 10% over what the dashboard weighs today. */
export const BUDGET = { js: 410_000, css: 20_000 };

/** Everything else in `assets/` — fonts, images, the map grid — is not code and not budgeted here. */
const KINDS = ["js", "css"];

/**
 * @param {{ name: string, contents: Buffer }[]} files
 * @returns {{ name: string, raw: number, gzipped: number }[]}
 */
export function measure(files) {
  return files.map(({ name, contents }) => ({
    name,
    raw: contents.byteLength,
    gzipped: gzipSync(contents).byteLength,
  }));
}

/**
 * @param {{ name: string, raw: number, gzipped: number }[]} assets
 * @param {{ js: number, css: number }} budget
 * @returns {{ failed: boolean, kinds: { kind: string, gzipped: number, raw: number, budget: number, over: boolean }[] }}
 */
export function checkBudget(assets, budget) {
  const kinds = KINDS.map((kind) => {
    const own = assets.filter((asset) => asset.name.endsWith(`.${kind}`));
    const gzipped = own.reduce((total, asset) => total + asset.gzipped, 0);
    const limit = budget[kind] ?? 0;
    return {
      kind,
      gzipped,
      raw: own.reduce((total, asset) => total + asset.raw, 0),
      budget: limit,
      over: gzipped > limit,
    };
  });
  return { failed: kinds.some((entry) => entry.over), kinds };
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

if (process.argv[1]?.endsWith("bundle-budget.mjs")) {
  const dir = process.argv[2] ?? ASSETS;
  let names;
  try {
    names = await readdir(dir);
  } catch {
    process.stdout.write(`${dir} does not exist — run npm run build:ui first\n`);
    process.exit(1);
  }

  const files = await Promise.all(
    names.map(async (name) => ({ name, contents: await readFile(join(dir, name)) })),
  );
  const { failed, kinds } = checkBudget(measure(files), BUDGET);

  for (const entry of kinds) {
    const verdict = entry.over ? "OVER BUDGET" : "ok";
    process.stdout.write(
      `${entry.kind}: ${kb(entry.gzipped)} gzipped (${kb(entry.raw)} raw) of ${kb(entry.budget)} — ${verdict}\n`,
    );
  }
  if (failed) {
    process.stdout.write(
      "\nThe budget is a ceiling, not a target: find what grew before raising it.\n",
    );
  }
  process.exit(failed ? 1 : 0);
}
