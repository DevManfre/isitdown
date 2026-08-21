import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API_PATHS = ["/status", "/config", "/history", "/incidents", "/notifications", "/poll", "/api", "/health"];

export default defineConfig({
  root: "src/ui/web",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": new URL("./src/ui/web/", import.meta.url).pathname },
  },
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
  },
});
