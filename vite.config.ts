// `vitest/config` re-exports Vite's own `defineConfig` with the `test` block
// added to the config type. Importing it from "vite" instead type-errors on
// `test` — invisibly, until this file was pulled into tsconfig.web.json.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API_PATHS = ["/status", "/config", "/history", "/incidents", "/notifications", "/poll", "/api", "/health", "/map"];

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
  },
});
