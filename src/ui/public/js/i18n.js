/**
 * Dashboard i18n. `en` is the source catalog and the fallback for a missing key;
 * a language whose catalog 404s falls back to `en` rather than rendering keys.
 *
 * Nothing here builds a sentence by joining translated fragments — word order
 * differs per language, so every string is one key with named placeholders.
 */

const SOURCE = "en";

let active = SOURCE;
let catalog = {};
let source = {};

export async function loadCatalog(lang) {
  if (Object.keys(source).length === 0) {
    source = await fetchCatalog(SOURCE);
  }
  if (lang === SOURCE) {
    catalog = source;
    active = SOURCE;
    return active;
  }
  try {
    catalog = await fetchCatalog(lang);
    active = lang;
  } catch {
    catalog = source;
    active = SOURCE;
  }
  return active;
}

async function fetchCatalog(lang) {
  const response = await fetch(`./locales/${lang}.json`);
  if (!response.ok) throw new Error(`no catalog for ${lang}`);
  return response.json();
}

export const activeLocale = () => active;

export function t(key, params = {}) {
  const template = catalog[key] ?? source[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in params ? String(params[name]) : match,
  );
}

/** Picks the plural form with Intl.PluralRules rather than an English `n === 1`. */
export function tPlural(baseKey, count, params = {}) {
  const rule = new Intl.PluralRules(active).select(count);
  const key = `${baseKey}.${rule}`;
  const fallback = `${baseKey}.other`;
  const template = catalog[key] ?? catalog[fallback] ?? source[key] ?? source[fallback] ?? baseKey;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    if (name === "count") return formatNumber(count);
    return name in params ? String(params[name]) : match;
  });
}

/**
 * Fills every [data-i18n] node and [data-i18n-*] attribute under `root`.
 * @param {ParentNode} root
 */
export function applyTranslations(root = document) {
  for (const node of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll("[data-i18n]"))) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of /** @type {NodeListOf<HTMLInputElement>} */ (
    root.querySelectorAll("[data-i18n-placeholder]")
  )) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  for (const node of /** @type {NodeListOf<HTMLElement>} */ (
    root.querySelectorAll("[data-i18n-title]")
  )) {
    node.title = t(node.dataset.i18nTitle);
  }
}

export const formatNumber = (value) => new Intl.NumberFormat(active).format(value);

export const formatPercent = (value) =>
  new Intl.NumberFormat(active, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    value,
  ) + "%";

export const formatTime = (iso) =>
  new Intl.DateTimeFormat(active, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export const formatDateTime = (iso) =>
  new Intl.DateTimeFormat(active, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export const formatDay = (day) =>
  new Intl.DateTimeFormat(active, { day: "numeric", month: "short" }).format(new Date(`${day}T00:00:00Z`));

/** Relative time from now, e.g. "3 minutes ago" / "fra 2 ore". */
export function formatRelative(iso) {
  const formatter = new Intl.RelativeTimeFormat(active, { numeric: "auto" });
  const deltaSeconds = (Date.parse(iso) - Date.now()) / 1000;
  /** @type {{unit: Intl.RelativeTimeFormatUnit, seconds: number}[]} */
  const units = [
    { unit: "day", seconds: 86400 },
    { unit: "hour", seconds: 3600 },
    { unit: "minute", seconds: 60 },
    { unit: "second", seconds: 1 },
  ];
  for (const { unit, seconds } of units) {
    if (Math.abs(deltaSeconds) >= seconds || unit === "second") {
      return formatter.format(Math.round(deltaSeconds / seconds), unit);
    }
  }
  return formatter.format(0, "second");
}

/** A duration in minutes rendered with the locale's own unit words. */
export function formatDuration(minutes) {
  const formatter = new Intl.NumberFormat(active, { style: "unit", unitDisplay: "short" });
  if (minutes < 60) {
    return new Intl.NumberFormat(active, { style: "unit", unit: "minute", unitDisplay: "short" }).format(
      Math.round(minutes),
    );
  }
  const hours = minutes / 60;
  if (hours < 24) {
    return new Intl.NumberFormat(active, { style: "unit", unit: "hour", unitDisplay: "short" }).format(
      Math.round(hours * 10) / 10,
    );
  }
  return formatter
    ? new Intl.NumberFormat(active, { style: "unit", unit: "day", unitDisplay: "short" }).format(
        Math.round((hours / 24) * 10) / 10,
      )
    : String(minutes);
}
