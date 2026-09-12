// `vitest/config` re-exports Vite's own `defineConfig` with the `test` block
// added to the config type. Importing it from "vite" instead type-errors on
// `test` — invisibly, until this file was pulled into tsconfig.web.json.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API_PATHS = ["/status", "/config", "/history", "/incidents", "/notifications", "/poll", "/api", "/health", "/ready", "/map", "/events"];

export default defineConfig({
  root: "src/ui/web",
  // Relative, not absolute: this resolved correctly both while the bundle was
  // staged at /next/ during the port and now that it is served from /.
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": new URL("./src/ui/web/", import.meta.url).pathname },
  },
  build: {
    outDir: "../../../dist/ui/public",
    // Required explicitly: outDir is outside the Vite root, so Vite refuses to
    // clear it otherwise.
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(API_PATHS.map((path) => [path, "http://localhost:3000"])),
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
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
});
