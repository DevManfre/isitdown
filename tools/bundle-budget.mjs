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

/**
 * Gzipped bytes per kind. Roughly 10% over what the dashboard weighs today.
 *
 * The JS ceiling moved 410k -> 470k when the rail's add wizard landed on a
 * stepper built from `motion.div` / `motion.span` / `motion.path`: until then
 * the dashboard only ever imported motion's hooks (`useMotionValue`,
 * `useSpring` in NumberTicker), so its DOM renderer stayed out of the bundle.
 * Rendering through it costs ~40 kB gzipped, and the whole animated wizard
 * would have to be rewritten in CSS keyframes to give that back. Code
 * splitting does not help here: this check sums every .js the build emits.
 *
 * It moved 470k -> 525k for roadmap 5.14's four new languages. Measured, not
 * estimated: the same build weighed 439.3 kB before `de`, `es`, `fr` and `pt`
 * landed and 488.4 kB after, so the four catalogs cost **49.1 kB gzipped** —
 * about 11% of the bundle. That is worth naming plainly, because unlike motion
 * it is not code every page needs: it is five catalogs a given reader will
 * never open, and `lib/i18n.ts` imports them eagerly so that no request can ask
 * the server for a catalog path.
 *
 * The way to give it back is per-locale code splitting — `en` eager as the
 * fallback, the rest behind `import()`. That is a real improvement for readers
 * and it is deliberately NOT done here, because this check sums every emitted
 * chunk: splitting would leave the measured total unchanged and would only pay
 * off if this budget also learned to count a first load rather than the whole
 * build. Those are two changes, and the second one is a decision about what
 * this check means, so both are left for their own pass rather than smuggled
 * in behind a language.
 *
 * It moved 525k -> 526,336 (512.7 -> 514.0 kB) for roadmap 1.3's suspected
 * status. Measured: 510.7 kB before it, 513.3 kB after — 2.6 kB gzipped, about
 * half of it the seven new strings in six catalogs, the rest the hatch, the
 * shared tooltip and one rule threaded through six views. Still the same
 * remedy as above, still deliberately not taken here.
 *
 * It moved 526,336 -> 530,330 (514.0 -> 517.9 kB) for roadmap 1.4's IMAP
 * adapter. Measured: 513.3 kB before it, 517.2 kB after — 3.9 kB gzipped, of
 * which the twenty-three new strings in six catalogs alone gzip to 3.3 kB; the
 * rest is the form's one block of fields. The same remedy again.
 *
 * It moved 530,330 -> 532,275 (517.9 -> 519.8 kB) for roadmap 1.5's
 * credentials. Measured: 517.2 kB before it, 519.1 kB after — 1.9 kB gzipped,
 * most of it the twelve new strings in six catalogs, the rest the one block of
 * fields every page adapter now shares. The same remedy again.
 *
 * It moved 532,275 -> 533,875 (519.8 -> 521.4 kB) for roadmap 1.8's suspect
 * reading. Measured: 519.6 kB before it, 520.7 kB after — 1.1 kB gzipped, the
 * four new strings in six catalogs and the badge that shows them. The same
 * remedy again.
 *
 * It moved 533,875 -> 537,400 (521.4 -> 524.8 kB) for roadmap 1.10, 1.11 and
 * 1.12. Measured: 520.7 kB before them, 524.1 kB after — 3.4 kB gzipped, most of
 * it the twenty-odd new strings in six catalogs (the watchdog's form explains
 * itself at length), the rest that form, the edited-after-resolution tile and
 * the trust card's fourth axis. The same remedy again.
 */
export const BUDGET = { js: 537_400, css: 20_000 };

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
