// tsc emits JavaScript only. The runtime also needs the i18n notification
// catalogs (Vite has no reason to touch these) and, for the UI edition, the
// server-side copy of the dashboard locale catalogs it enumerates from disk
// at startup. Copy both into dist so a built image can be started from dist
// alone.
import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const assets = [
  { from: "src/core/i18n", to: "dist/core/i18n", filter: (p) => !p.endsWith(".ts") },
  // The server enumerates the dashboard catalogs from disk to build the
  // uiLocale enum, so they must exist in dist even though Vite also bundles
  // them into the client. dist/ui/public itself is Vite's own build output
  // now (vite.config.ts outDir), not something this script copies.
  { from: "src/ui/web/locales", to: "dist/ui/web/locales" },
];

for (const asset of assets) {
  const from = resolve(root, asset.from);
  const to = resolve(root, asset.to);
  if (!existsSync(from)) continue;
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, {
    recursive: true,
    ...(asset.filter ? { filter: (src) => src === from || asset.filter(src) } : {}),
  });
  console.log(`copied ${asset.from} -> ${asset.to}`);
}
