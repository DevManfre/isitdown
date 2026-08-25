import { readdirSync } from "node:fs";
import { Router } from "express";
import { z } from "zod";
import { availableLocales as notificationLocales } from "../../core/i18n/index.ts";
import { readSettings, writeSettings } from "../dbConfigSource.ts";
import type { UiRuntimeCore } from "../runtime.ts";

const LOCALES_DIR = new URL("../web/locales/", import.meta.url);

/**
 * Dashboard locales are whatever catalogs are on disk, so adding a language is
 * dropping in one JSON file — no code change, which is the rule the i18n design
 * sets for itself.
 */
export function availableUiLocales(): string[] {
  return readdirSync(LOCALES_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
}

/**
 * Theme and locale preferences, plus the catalog endpoint the dashboard loads.
 *
 * The UI locale and the notification locale are separate fields on purpose: an
 * operator can read an English dashboard and receive Italian alerts.
 */
export function preferencesRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();
  const uiLocales = availableUiLocales();

  const patchSchema = z.object({
    theme: z.enum(["light", "dark", "system"]).optional(),
    uiLocale: z.enum(uiLocales as [string, ...string[]]).optional(),
    notificationLocale: z.enum(notificationLocales as unknown as [string, ...string[]]).optional(),
  });

  const current = () => {
    const settings = readSettings(runtime.db, runtime.logger);
    return {
      theme: settings.theme,
      uiLocale: settings.uiLocale,
      notificationLocale: settings.notificationLocale,
    };
  };

  router.get("/api/preferences", (_req, res) => {
    res.json(current());
  });

  router.patch("/api/preferences", (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          message: parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
        },
      });
      return;
    }
    writeSettings(runtime.db, parsed.data);
    res.json(current());
  });

  return router;
}
