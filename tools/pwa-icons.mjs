import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Renders the PWA's PNG icons from `favicon.svg` — roadmap 5.21.
 *
 * Generated rather than drawn again, and generated *from the favicon*, so the
 * mark on a phone's home screen can never drift from the one in the browser
 * tab — the same reason the favicon itself is kept in step with `BrandMark.tsx`
 * by hand. It renders with the Chromium the visual harness already caches, so
 * no image library joins a project whose whole promise is that it needs none.
 *
 * Run it when the mark changes: `node tools/pwa-icons.mjs`. The output is
 * committed, because an image build must not need a browser.
 *
 * Two shapes, because Android asks for both:
 *
 * - **`icon-<n>.png`** is the mark as it is, edge to edge, on transparency.
 * - **`maskable-<n>.png`** is the same mark at 60% inside a full-bleed
 *   background, so a launcher may crop it to a circle, a squircle or a rounded
 *   square without cutting the pulse trace off. Without one, Android drops the
 *   icon into a white circle and the result reads as a bug.
 *
 * Chromium's own `--screenshot` is used rather than the harness's CDP driver:
 * that driver waits for the dashboard's queries to go quiet before it shoots,
 * and this page has none. A one-shot flag is the whole job here.
 */

const CACHE = join(homedir(), ".cache", "ms-playwright");
const OUT = new URL("../src/ui/web/public/icons/", import.meta.url).pathname;
const SIZES = [192, 512];
/** The darker of the mark's own two gradient stops: what a maskable crop bleeds into. */
const MASK_BACKGROUND = "#5d5294";

function findChromium() {
  if (!existsSync(CACHE)) return null;
  return (
    readdirSync(CACHE)
      .filter((name) => name.startsWith("chromium-"))
      .map((name) => ({
        revision: Number.parseInt(name.split("-")[1] ?? "0", 10),
        path: join(CACHE, name, "chrome-linux64", "chrome"),
      }))
      .filter((candidate) => existsSync(candidate.path))
      .sort((left, right) => right.revision - left.revision)[0]?.path ?? null
  );
}

/** A page holding one icon at exactly `size` square, with nothing else on it. */
function page(svg, size, maskable) {
  const inset = Math.round(size * 0.2);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; width: ${size}px; height: ${size}px; overflow: hidden; }
    body { background: ${maskable ? MASK_BACKGROUND : "transparent"}; }
    .mark { position: absolute; inset: ${maskable ? inset : 0}px; }
    .mark svg { width: 100%; height: 100%; display: block; }
  </style></head><body><div class="mark">${svg}</div></body></html>`;
}

const binary = findChromium();
if (binary === null) {
  console.error(
    `no cached Chromium under ${CACHE}. Run "npx --yes playwright@latest install chromium" once, then retry.`,
  );
  process.exit(1);
}

const svg = await readFile(new URL("../src/ui/web/public/favicon.svg", import.meta.url), "utf8");
const work = await mkdtemp(join(tmpdir(), "isitdown-icons-"));
await mkdir(OUT, { recursive: true });

try {
  for (const size of SIZES) {
    for (const maskable of [false, true]) {
      const name = `${maskable ? "maskable" : "icon"}-${size}.png`;
      const html = join(work, `${name}.html`);
      await writeFile(html, page(svg, size, maskable));
      await new Promise((resolve, reject) => {
        const chrome = spawn(
          binary,
          [
            "--headless=new",
            "--no-sandbox",
            "--force-device-scale-factor=1",
            "--hide-scrollbars",
            // Transparent for the plain icon so a light tab strip does not show
            // a dark square behind the mark's rounded corners; the maskable one
            // paints its own opaque ground.
            ...(maskable ? [] : ["--default-background-color=00000000"]),
            `--window-size=${size},${size}`,
            `--screenshot=${join(OUT, name)}`,
            `file://${html}`,
          ],
          { stdio: ["ignore", "ignore", "pipe"] },
        );
        chrome.on("error", reject);
        chrome.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`chromium exited with ${code} rendering ${name}`)),
        );
      });
      console.log(`wrote icons/${name}`);
    }
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
