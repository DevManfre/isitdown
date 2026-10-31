import { readdirSync } from "node:fs";
import { Router } from "express";
import { z } from "zod";
import { availableLocales as notificationLocales } from "../../core/i18n/index.ts";
import {
  accentColor,
  INSTANCE_NAME_MAX,
  logoUrl,
  readSettings,
  writeSettings,
} from "../dbConfigSource.ts";
import { THEME_MODES } from "../themeModes.ts";
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
    theme: z.enum(THEME_MODES).optional(),
    accentColor: accentColor.optional(),
    instanceName: z.string().trim().max(INSTANCE_NAME_MAX).optional(),
    logoUrl: logoUrl.optional(),
    uiLocale: z.enum(uiLocales as [string, ...string[]]).optional(),
    notificationLocale: z
      .enum(notificationLocales as unknown as [string, ...string[]])
      .optional(),
    mapView: z.enum(["off", "map", "globe"]).optional(),
    density: z.enum(["comfortable", "compact"]).optional(),
    wizardDone: z.boolean().optional(),
    tourSeen: z.boolean().optional(),
    // Validated against the runtime's own zone table rather than a hand-kept
    // list: "is this a zone?" is a question Intl can answer exactly, and a
    // preference that stores a name nothing can format is a dashboard of
    // Invalid Dates.
    timeZone: z
      .string()
      .max(64)
      .refine(isTimeZone, {
        message: 'must be "auto" or an IANA time zone name',
      })
      .optional(),
    // Roadmap 4.4. Null clears it, which brings the next visit back to "first
    // visit": nothing to recount, only a time to start from.
    lastSeenAt: z.string().datetime().nullable().optional(),
  });

  const current = () => {
    const settings = readSettings(runtime.db, runtime.logger);
    return {
      theme: settings.theme,
      accentColor: settings.accentColor,
      instanceName: settings.instanceName,
      logoUrl: settings.logoUrl,
      uiLocale: settings.uiLocale,
      notificationLocale: settings.notificationLocale,
      mapView: settings.mapView,
      density: settings.density,
      wizardDone: settings.wizardDone,
      tourSeen: settings.tourSeen,
      timeZone: settings.timeZone,
      lastSeenAt: settings.lastSeenAt === "" ? null : settings.lastSeenAt,
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
    const { lastSeenAt, ...rest } = parsed.data;
    writeSettings(runtime.db, {
      ...rest,
      ...(lastSeenAt === undefined ? {} : { lastSeenAt: lastSeenAt ?? "" }),
    });
    res.json(current());
  });

  return router;
}
