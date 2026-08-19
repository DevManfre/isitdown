import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";

/**
 * Notification strings, shared by both editions. `en` is the source language
 * and the fallback for anything missing. This module stays edition-agnostic and
 * language-unaware beyond lookup: the diff engine passes structured changes,
 * and the notifier asks for the rendered string.
 */

export const catalogSchema = z.record(z.string());

export const SOURCE_LOCALE = "en";

const catalogDir = new URL(".", import.meta.url);

function loadCatalogs(): Map<string, Record<string, string>> {
  const catalogs = new Map<string, Record<string, string>>();
  for (const file of readdirSync(catalogDir)) {
    if (!file.endsWith(".json")) continue;
    const raw: unknown = JSON.parse(readFileSync(new URL(file, catalogDir), "utf8"));
    catalogs.set(file.slice(0, -".json".length), catalogSchema.parse(raw));
  }
  if (!catalogs.has(SOURCE_LOCALE)) {
    throw new Error(`missing source catalog ${SOURCE_LOCALE}.json in ${catalogDir.pathname}`);
  }
  return catalogs;
}

const catalogs = loadCatalogs();

export const availableLocales: readonly string[] = Object.freeze([...catalogs.keys()]);

/**
 * Resolves a key in `locale`, falling back to the `en` value, and finally to the
 * key itself — never an empty string, which would render as a blank message.
 */
export function t(
  locale: string,
  key: string,
  params: Record<string, string | number> = {},
): string {
  const template =
    catalogs.get(locale)?.[key] ?? catalogs.get(SOURCE_LOCALE)?.[key] ?? key;
  // A placeholder with no matching param is left in place: a visible {title}
  // in a message is a bug report, an empty gap is a mystery.
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * Notification timestamps stay UTC with an explicit suffix in every locale, so
 * an operator reading alerts in two languages never has to guess the zone.
 */
export function formatUtc(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    throw new Error(`unparseable timestamp: ${iso}`);
  }
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} UTC`;
}
