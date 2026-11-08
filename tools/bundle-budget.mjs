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
 * It moved 553,500 -> 563,500 (540.5 -> 550.3 kB) for the sequence probe and the
 * tcp `check` option (roadmap 2.14, 2.15): their form fields and about forty
 * strings in six catalogs. Measured: 535.8 kB before, 542.5 kB after.
 *
 * It moved 533,875 -> 537,400 (521.4 -> 524.8 kB) for roadmap 1.10, 1.11 and
 * 1.12. Measured: 520.7 kB before them, 524.1 kB after — 3.4 kB gzipped, most of
 * it the twenty-odd new strings in six catalogs (the watchdog's form explains
 * itself at length), the rest that form, the edited-after-resolution tile and
 * the trust card's fourth axis. The same remedy again.
 *
 * It moved 537,400 -> 539,450 (524.8 -> 526.8 kB) for roadmap 2.2's catalog
 * updates row. Measured: 524.1 kB before it, 526.1 kB after — 2.0 kB gzipped,
 * nearly all of it the eight new strings in six catalogs, the disclosure among
 * them long on purpose. The same remedy again.
 *
 * It moved 539,450 -> 543,500 (526.8 -> 530.7 kB) for roadmap 2.9 and 2.10's
 * dashboard: the depends-on field, the shared-failure card and the
 * break-together card. Measured: 526.1 kB before them, 530.1 kB after — 4.0 kB
 * gzipped, from three small components and eighteen new strings in six
 * catalogs. The same remedy again.
 *
 * It moved 543,500 -> 553,500 (530.7 -> 540.5 kB) for the adapters added since
 * v2.16.0 (GitHub Actions, package registries, OpenStatus, Sorry, cState,
 * Upptime, Status.io, federation) and their dashboard fields. Measured: 530.1 kB
 * before them, 535.8 kB after, mostly the new strings in six catalogs. The same
 * remedy again.
 *
 * It moved 563,500 -> 573,500 (550.3 -> 560.1 kB) for roadmap 3.4-3.7: the
 * recipients editor, the follow button, the impact and owner fields and the
 * channel-health row, with about thirty-five new strings in six catalogs.
 * Measured: 547.7 kB before them, 553.6 kB after. The same remedy again.
 *
 * It moved 573,500 -> 583,500 (560.1 -> 569.8 kB) for roadmap 3.15-3.16: the
 * on-call rotation editor and the routine-test switch, with fourteen new
 * strings in six catalogs. Measured: under 560.1 kB before them, 562.7 kB
 * after. The same remedy again.
 *
 * It moved 583,500 -> 603,500 (569.8 -> 589.4 kB) and css 20,000 -> 21,500
 * (19.5 -> 21.0 kB) for roadmap 4.1, the composable Overview: the widget
 * registry and grid, the edit mode (toolbar, filter, catalogue, sticky bar,
 * dialogs, drag) and about eighty-five new strings in six catalogs. Measured:
 * 562.7 kB js and 19.5 kB css before it, 580.8 kB and 20.1 kB after — about
 * half the js the strings, half the code. The edit mode was a lazy chunk at
 * first; since this check sums every .js the build emits, splitting it only
 * added a shared chunk and cost 6 kB more in total, so it ships in the one
 * bundle like everything else.
 *
 * It moved 603,500 -> 635,500 (589.4 -> 620.6 kB) for the widget catalogue's
 * second round: twelve widgets (open incidents, maintenance, error budget,
 * provider tile, sparklines, year calendar, weekday × hour, MTTR/MTBF,
 * annotations, delivery, heartbeats, break-together) and about a hundred and
 * fifty strings in six catalogs. Measured: 580.8 kB before, 611.1 kB after —
 * some 18 kB of it the strings, each widget's sentence that states its
 * finding being long on purpose, the rest the twelve components.
 *
 * It moved 635,500 -> 645,500 (620.6 -> 630.4 kB) for roadmap 4.2's named
 * dashboards: the rail's list, the header's menu, the create, rename, delete
 * and import dialogs with their Undo, and some sixty strings in six catalogs.
 * Measured: 612.0 kB before, 621.4 kB after — most of the 9.4 kB the strings.
 *
 * It moved 645,500 -> 675,500 (630.4 -> 659.7 kB), and CSS 21,500 -> 22,000,
 * for roadmap 4.3's linked figures, 4.4's "while you were away" summary and the
 * catalogue's third round of twelve widgets. Measured: 621.7 kB before, 648.1
 * kB after — the bulk of the 26.4 kB the ~210 new strings in six catalogs,
 * each widget again stating its finding as a sentence; CSS 21.0 -> 21.2 kB for
 * the new utility classes the widgets draw with.
 *
 * It moved 675,500 -> 685,500 (659.7 -> 669.4 kB), and CSS 22,000 -> 22,500,
 * for roadmap 4.6's first-run setup wizard and guided tour. Measured: 650.4 kB
 * before, 659.6 kB after — 9.1 kB gzipped, the two components and some fifty
 * new strings in six catalogs; CSS 21.4 -> 21.6 kB for the tour's veil, ring
 * and card motion and the wizard's utility classes.
 *
 * It moved 685,500 -> 695,500 (669.4 -> 679.2 kB), and CSS 22,500 -> 23,000,
 * for roadmaps 4.16 to 4.20: the persisted view state, the shortcut map and its
 * matcher, three theme variants, the accent, name and logo rows, the status
 * announcer, and some sixty strings in six catalogs. Measured: 667.1 kB before,
 * 674.8 kB after — 7.7 kB gzipped, most of it the strings and the two dialogs'
 * worth of components; CSS 21.7 -> 22.0 kB for the variants' override blocks.
 *
 * It moved 695,500 -> 709,500 (679.2 -> 692.9 kB) for roadmaps 4.21 to 4.24:
 * the Components view, the incident band, the fleet-order dialog, the
 * unreachable-server and unmeasured states, and some seventy-five strings in
 * six catalogs. Measured: 675.6 kB before, 687.6 kB after — 12.0 kB gzipped, of
 * which the dialog with motion's `Reorder` is 3.1 kB and the rest is mostly the
 * strings (51 kB raw over the whole change, nearly all of it catalog text).
 *
 * It moved 709,500 -> 720,500 (692.9 -> 703.6 kB) for roadmaps 4.25 to 4.28.
 * Measured: 687.6 kB before, 698.2 kB after — 10.6 kB gzipped, of which 7.0 kB
 * is `qrcode-generator` (the wallboard's QR code), loaded only on that screen
 * but counted all the same because this check sums every emitted chunk. The
 * rest is the sound and pulse code and some fifteen strings in six catalogs.
 * The e-ink PNG is server-side and weighs nothing here.
 *
 * CSS moved 23,000 -> 23,500 (22.5 -> 22.9 kB) for roadmap 4.29's one-hand
 * Overview: the phone's problems-first list, its swipe-to-mute rows and the
 * pull-to-poll indicator. No stylesheet changed — measured 22.4 kB before,
 * 22.6 kB after, all of it the new utility classes `MobileProblems` draws with.
 *
 * It moved 720,500 -> 731,000 (703.6 -> 713.9 kB) for roadmaps 5.1 to 5.6.
 * Measured: 701.9 kB before, 712.5 kB after — 10.6 kB gzipped, 42 kB raw, most
 * of it some eighty strings in six catalogs (the schedule and bulk-edit
 * dialogs are mostly labels). The rest is those two dialogs and the runbook's
 * Markdown renderer, which is a few regular expressions rather than a library.
 *
 * It moved 731,000 -> 742,000 (713.9 -> 724.6 kB) for roadmaps 5.11 to 5.14.
 * Measured: 713.6 kB before (v2.37.0), 722.9 kB after (740,257 bytes) — 9.3 kB
 * gzipped, 30 kB raw. By feature, each measured with the ones before it in:
 * 5.13's silence button +0.6, 5.14's star and the wallboard's paging +0.7, 5.11's
 * explanation chain +2.3, 5.12's replay panel +5.7. The replay is the large one
 * because it words six kinds of step, each with its own outcomes, and that is
 * most of the forty-six strings (276 lines) this lot added to six catalogs.
 * No dependency was added; the CSS did not move.
 */
export const BUDGET = { js: 742_000, css: 23_500 };

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
