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
/** Whether a stored value is one this runtime can actually format a date in. */
export function isTimeZone(value: string): boolean {
  if (value === "auto") return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function preferencesRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();
  const uiLocales = availableUiLocales();

  const patchSchema = z.object({
    theme: z.enum(["light", "dark", "system"]).optional(),
    uiLocale: z.enum(uiLocales as [string, ...string[]]).optional(),
    notificationLocale: z.enum(notificationLocales as unknown as [string, ...string[]]).optional(),
    mapView: z.enum(["off", "map", "globe"]).optional(),
    // Validated against the runtime's own zone table rather than a hand-kept
    // list: "is this a zone?" is a question Intl can answer exactly, and a
    // preference that stores a name nothing can format is a dashboard of
    // Invalid Dates.
    timeZone: z.string().max(64).refine(isTimeZone, { message: "must be \"auto\" or an IANA time zone name" }).optional(),
  });

  const current = () => {
    const settings = readSettings(runtime.db, runtime.logger);
    return {
      theme: settings.theme,
      uiLocale: settings.uiLocale,
      notificationLocale: settings.notificationLocale,
      mapView: settings.mapView,
      timeZone: settings.timeZone,
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
