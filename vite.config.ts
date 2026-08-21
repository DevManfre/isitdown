import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API_PATHS = ["/status", "/config", "/history", "/incidents", "/notifications", "/poll", "/api", "/health"];

export default defineConfig({
  root: "src/ui/web",
  plugins: [react(), tailwindcss()],
  build: {
    // Staging output until the cutover commit moves this to dist/ui/public.
    outDir: "../../../dist/ui/web",
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
    // This task adds no *.test.tsx yet — the first lands in Task 2. Without
    // this, `vitest run` exits 1 on an empty suite and `npm test` never passes.
    passWithNoTests: true,
  },
});
