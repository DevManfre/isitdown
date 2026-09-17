// A single-file Light edition — roadmap 6.7. For an operator who wants neither
// Docker nor a Node install: one executable, one `config.yml` beside it.
//
// UI edition only ever ships as an image. It serves a built dashboard out of
// `dist/ui/public`, which is thousands of files a binary would have to carry
// and an operator would have to be told about; Light is a poller and a
// notifier, which is exactly the shape that fits in one file.
//
// Three steps, all of them Node's own: bundle the entry to one CommonJS file
// (Node's SEA has no top-level `await` and no ESM loader), build the blob from
// `sea-config.json`, then inject it into a copy of this very Node binary with
// postject. The binary is whichever `node` runs this script, so the build is
// pinned to the version in `.nvmrc` without a second place saying so.
import { chmod, copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist/sea");
const bundle = join(outDir, "isitdown-light.cjs");
const blob = join(outDir, "isitdown-light.blob");
const binary = join(outDir, process.platform === "win32" ? "isitdown-light.exe" : "isitdown-light");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// `noExternal` is what makes this one file: yaml and zod are the runtime
// dependencies, and a binary that expected a node_modules beside it would not
// be a binary.
await build({
  root,
  configFile: false,
  logLevel: "warn",
  build: {
    ssr: "src/light/index.ts",
    outDir: "dist/sea",
    emptyOutDir: false,
    target: "node24",
    minify: false,
    rollupOptions: {
      output: { format: "cjs", entryFileNames: "isitdown-light.cjs", codeSplitting: false },
    },
  },
  ssr: { noExternal: true, target: "node" },
});

// The notification catalogs travel as SEA assets: there is no `dist` beside a
// binary to read them from. `src/core/i18n/index.ts` enumerates these keys the
// same way it enumerates the directory, so adding a locale needs no edit here.
const localeDir = join(root, "src/core/i18n");
const assets = {};
for (const file of await readdir(localeDir)) {
  if (!file.endsWith(".json")) continue;
  assets[`i18n/${file}`] = join(localeDir, file);
}

const seaConfig = join(outDir, "sea-config.json");
await writeFile(
  seaConfig,
  `${JSON.stringify(
    {
      main: bundle,
      output: blob,
      disableExperimentalSEAWarning: true,
      // Neither is worth its cost here: a startup snapshot refuses a main that
      // touches the network or the filesystem at load time, and code cache
      // pins the blob to one Node build for a boot this does not need to win.
      useSnapshot: false,
      useCodeCache: false,
      assets,
    },
    null,
    2,
  )}\n`,
);

execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" });

await copyFile(process.execPath, binary);
await chmod(binary, 0o755);

execFileSync(
  "npx",
  [
    "--yes",
    "postject",
    binary,
    "NODE_SEA_BLOB",
    blob,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    ...(process.platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : []),
  ],
  { stdio: "inherit" },
);

console.log(`built ${binary}`);
console.log("run it with a config.yml beside it: CONFIG_PATH=./config.yml DATA_PATH=./state.json " + binary);
