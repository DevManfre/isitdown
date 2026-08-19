// tsc emits JavaScript only. The runtime also needs the i18n catalogs and, for
// the UI edition, the whole dashboard tree. Copy both into dist so a built
// image can be started from dist alone.
import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const assets = [
  { from: "src/core/i18n", to: "dist/core/i18n", filter: (p) => !p.endsWith(".ts") },
  { from: "src/ui/public", to: "dist/ui/public" },
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
