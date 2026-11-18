// `vitest/config` re-exports Vite's own `defineConfig` with the `test` block
// added to the config type. Importing it from "vite" instead type-errors on
// `test` — invisibly, until this file was pulled into tsconfig.web.json.
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API_PATHS = ["/status", "/config", "/history", "/incidents", "/notifications", "/poll", "/api", "/health", "/ready", "/map", "/events"];

/**
 * Roadmap 13.9. The component catalog lives in its own HTML entry,
 * `__catalog/index.html`; this only sends `/__catalog` (no slash) there rather
 * than to the dashboard's fallback page. `apply: "serve"`: a production build
 * never sees it, and the build's single input stays `index.html`.
 */
const catalogRoute: Plugin = {
  name: "isitdown-catalog-route",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url !== "/__catalog") return next();
      res.statusCode = 302;
      res.setHeader("location", "/__catalog/");
      res.end();
    });
  },
};

export default defineConfig(({ mode }) => ({
  root: "src/ui/web",
  // Relative, not absolute: this resolved correctly both while the bundle was
  // staged at /next/ during the port and now that it is served from /.
  base: "./",
  plugins: [react(), tailwindcss(), catalogRoute],
  resolve: {
    alias: { "@": new URL("./src/ui/web/", import.meta.url).pathname },
  },
  // `--mode catalog` (npm run build:catalog) builds the component catalog on
  // its own, for the visual harness to serve; it never writes into the
  // dashboard's dist/ui/public.
  build:
    mode === "catalog"
      ? {
          outDir: "../../../dist/catalog",
          emptyOutDir: true,
          rolldownOptions: { input: new URL("./src/ui/web/__catalog/index.html", import.meta.url).pathname },
        }
      : {
          outDir: "../../../dist/ui/public",
          // Required explicitly: outDir is outside the Vite root, so Vite refuses to
          // clear it otherwise.
          emptyOutDir: true,
        },
  server: {
    port: 5173,
    proxy: Object.fromEntries(API_PATHS.map((path) => [path, "http://127.0.0.1:3000"])),
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Node 26 ships its own global `localStorage` (Web Storage), a getter that
    // answers `undefined` unless `--localstorage-file` is given. It shadows
    // happy-dom's, so every `localStorage.setItem` throws, the shared
    // `localStorage.clear()` in vitest.setup.ts throws with it, and the
    // uncleaned DOM then shows up as "found multiple elements" in the tests
    // that follow. The workers run without Node's, so happy-dom's is the one.
    execArgv: ["--no-experimental-webstorage"],
    // Vitest's default is 5s, which the userEvent-heavy suites (ServiceDialog,
    // Incidents pagination) sit close enough to that they fail intermittently
    // under `npm run coverage` — v8 instrumentation costs this suite ~45% wall
    // clock, and the failures rotate between tests and vanish on a re-run,
    // which is the signature of a deadline rather than a defect. Raising it
    // weakens no assertion: a test that is genuinely wrong still fails, it
    // simply gets long enough to say so on a loaded machine.
    testTimeout: 20_000,
    include: ["**/*.test.tsx", "**/*.test.ts"],
    // Roadmap 7.2. A floor, not a target: these sit a few points under what
    // the dashboard covers today, so ordinary movement passes and a new view
    // or hook that lands with no test of its own drags the total under and
    // fails. Raise them when the suite has genuinely climbed; never lower one
    // to make a red run green.
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      include: ["**/*.ts", "**/*.tsx"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "vitest.setup.ts", "test/**"],
      thresholds: { lines: 85, branches: 75, functions: 80, statements: 85 },
    },
  },
}));
