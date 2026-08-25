import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { configRoutes } from "./routes/config.routes.ts";
import { historyRoutes } from "./routes/history.routes.ts";
import { incidentsRoutes } from "./routes/incidents.routes.ts";
import { notificationsRoutes } from "./routes/notifications.routes.ts";
import { preferencesRoutes } from "./routes/preferences.routes.ts";
import { statusRoutes } from "./routes/status.routes.ts";
import type { UiRuntimeCore } from "./runtime.ts";

const PUBLIC_DIR = process.env["WEB_DIR"] ?? new URL("./public/", import.meta.url).pathname;

/**
 * The dashboard's HTTP surface. Every response is JSON except the static
 * dashboard itself, including errors: a browser fetch that gets an HTML error
 * page back reports a parse failure instead of the real problem.
 */
export function createApp(runtime: UiRuntimeCore): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  app.use(statusRoutes(runtime));
  app.use(historyRoutes(runtime));
  app.use(incidentsRoutes(runtime));
  app.use(notificationsRoutes(runtime));
  app.use(configRoutes(runtime));
  app.use(preferencesRoutes(runtime));

  app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { message: "not found" } });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : String(error);
    runtime.logger.error("request failed", { error: message });
    res.status(500).json({ error: { message } });
  });

  return app;
}
