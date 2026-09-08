#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../src/core/logger.ts";
import { NOW, seedVisualFixture } from "./visual/fixture.mjs";
import { withBrowser } from "./visual/chrome.mjs";
import { comparePng, decodePng, downscale } from "./visual/png.mjs";

/**
 * Visual regression for the dashboard (roadmap 7.1).
 *
 * The dashboard is large enough that a token change can quietly wreck a view
 * nobody opened — the last few slices shipped a tab favicon, a settings pair, a
 * badge and a card-gap fix, none of which any test could have caught. So: every
 * view, in both themes and both locales, rendered against a fixed fleet with a
 * frozen clock, and compared pixel by pixel with what was agreed.
 *
 *   node tools/visual-regression.mjs            # check against the baselines
 *   node tools/visual-regression.mjs --update   # agree to what it renders now
 *
 * A failure writes both images plus the count of moved pixels, so the reviewer
 * can see the change rather than being told a number.
 */

const ROOT = new URL("../", import.meta.url).pathname;
const BASELINE_DIR = join(ROOT, "test/visual/baseline");
const OUTPUT_DIR = join(ROOT, "test/visual/current");
const WEB_DIR = join(ROOT, "dist/ui/public");

/** Every view the rail can reach, by its hash route. */
const VIEWS = [
  { name: "overview", hash: "#/overview" },
  { name: "providers", hash: "#/providers" },
  { name: "incidents", hash: "#/incidents" },
  { name: "history", hash: "#/history" },
  { name: "delivery-log", hash: "#/delivery-log" },
  { name: "settings", hash: "#/settings" },
];

const THEMES = ["light", "dark"];
const LOCALES = ["en", "it"];

/** 16:10 at a laptop width: the shape the dashboard was designed against. */
const VIEWPORT = { width: 1440, height: 900 };

/**
 * Screenshots are compared after an 8× box downscale, which is what lets one
 * set of baselines hold on more than one machine: font rasterisation is not
 * portable, and the same page on a CI runner differs from the same page here
 * on up to 1.5% of its pixels along the edges of text alone. See `downscale`.
 *
 * Every threshold below is therefore counted in downscaled cells, each one an
 * 8×8 block of the original frame.
 */
const SCALE = 8;

/** Per-channel tolerance, in 0–255. Averaged-away antialiasing, nothing more. */
const CHANNEL_THRESHOLD = 12;

/**
 * How many cells may move at all, and how many may change colour outright,
 * before it counts as a regression.
 *
 * Measured rather than guessed. Cross-machine noise, over all 24 views: at most
 * 6 cells moved and never one recoloured. The changes this check exists to
 * catch, on the same frames: a status token edited moves 31 cells and recolours
 * 7, a vanished badge moves 19 and recolours 7, a four-pixel row shift moves
 * 500. The limits sit in the gap, nearer the noise than the signal.
 */
const MAX_MOVED = 12;
const MAX_RECOLOURED = 3;

/**
 * What counts as "changed colour outright" per channel. Lower than it would be
 * at full resolution: averaging a block dilutes a small strong change into a
 * moderate one, and a status dot is a small strong change.
 */
const STRONG_THRESHOLD = 40;

const shotName = (view, theme, locale) => `${view}-${theme}-${locale}.png`;

/**
 * Freezes this process's clock, before the server is loaded.
 *
 * Freezing only the browser's was not enough: the server buckets history by its
 * own clock, so a baseline recorded yesterday failed today with the uptime chart
 * shifted by exactly one day — Jun 15…Sep 7 became Jun 16…Sep 8, and the
 * percentages moved with it. The fixture, the server and the page now all read
 * the same instant, which is what makes a baseline hold on any day and on any
 * machine.
 *
 * Safe because this process is only ever the visual harness: nothing here polls
 * a provider, and the scheduler is never started.
 */
function freezeClock(at) {
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args) {
      super(...(args.length === 0 ? [at] : args));
    }
    static now() {
      return at;
    }
  }
  globalThis.Date = FrozenDate;
}

async function withServer(body) {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-visual-db-"));
  // Before the app module is loaded, not merely before the server listens:
  // `WEB_DIR` is read once at import time, and a static import would have
  // pinned the static root to a directory that only exists in a container.
  process.env["WEB_DIR"] = WEB_DIR;
  const { buildUiRuntime } = await import("../src/ui/runtime.ts");
  const runtime = await buildUiRuntime({
    dbPath: join(dir, "isitdown.db"),
    env: {},
    logger: createLogger("error", () => {}),
  });
  seedVisualFixture(runtime.db);

  // The scheduler is deliberately never started: a poll landing mid-run would
  // overwrite the fixture with whatever the real internet says today.
  const server = runtime.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  try {
    return await body(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await runtime.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  const update = process.argv.includes("--update");
  const only = process.argv.find((argument) => argument.startsWith("--only="))?.slice("--only=".length);

  if (!existsSync(join(WEB_DIR, "index.html"))) {
    console.error(`no dashboard bundle in ${WEB_DIR}. Run "npm run build:ui" first.`);
    process.exit(1);
  }

  // Before the fixture is written and before the server module is loaded.
  freezeClock(NOW);

  await mkdir(update ? BASELINE_DIR : OUTPUT_DIR, { recursive: true });
  const targetDir = update ? BASELINE_DIR : OUTPUT_DIR;
  const failures = [];
  const written = [];

  await withServer(async (base) => {
    await withBrowser({ frozenAt: NOW }, async ({ shot }) => {
      for (const view of VIEWS) {
        if (only !== undefined && view.name !== only) continue;
        for (const theme of THEMES) {
          for (const locale of LOCALES) {
            const name = shotName(view.name, theme, locale);
            const png = await shot({
              url: `${base}/${view.hash}`,
              colorScheme: theme,
              // Written straight into localStorage, which is where the
              // pre-paint script in index.html reads both from — the same path
              // an operator's own browser takes.
              storage: { "isitdown.theme": theme, "isitdown.uiLocale": locale },
              ...VIEWPORT,
            });

            const path = join(targetDir, name);
            await writeFile(path, png);
            written.push(name);

            if (update) continue;

            const baselinePath = join(BASELINE_DIR, name);
            if (!existsSync(baselinePath)) {
              failures.push(`${name}: no baseline yet — review ${path} and re-run with --update`);
              continue;
            }
            const result = comparePng(
              downscale(decodePng(await readFile(baselinePath)), SCALE),
              downscale(decodePng(png), SCALE),
              CHANNEL_THRESHOLD,
              STRONG_THRESHOLD,
            );
            if (result.sizeChanged) {
              failures.push(`${name}: the frame changed size`);
            } else if (result.differing > MAX_MOVED) {
              failures.push(
                `${name}: ${result.differing} of ${result.total} cells moved (${(result.ratio * 100).toFixed(2)}%) — see ${path}`,
              );
            } else if (result.recoloured > MAX_RECOLOURED) {
              failures.push(
                `${name}: ${result.recoloured} cells changed colour outright — see ${path}`,
              );
            }
          }
        }
      }
    });
  });

  if (update) {
    // A view that was removed leaves a baseline nothing renders any more, and a
    // stale baseline is a check that passes for the wrong reason.
    const stale = (await readdir(BASELINE_DIR)).filter(
      (name) => name.endsWith(".png") && !written.includes(name),
    );
    if (only === undefined) {
      for (const name of stale) await rm(join(BASELINE_DIR, name));
    }
    console.log(`agreed ${written.length} baselines${stale.length > 0 && only === undefined ? `, dropped ${stale.length} stale` : ""}`);
    return;
  }

  if (failures.length > 0) {
    console.error(`visual regression in ${failures.length} of ${written.length} views:`);
    for (const failure of failures) console.error(`  ${failure}`);
    console.error("\nIf the change is intended: node tools/visual-regression.mjs --update");
    process.exit(1);
  }

  console.log(`${written.length} views match their baselines`);
  await rm(OUTPUT_DIR, { recursive: true, force: true });
}

await main();
