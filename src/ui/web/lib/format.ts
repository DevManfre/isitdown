export const formatNumber = (locale: string, value: number) =>
  new Intl.NumberFormat(locale).format(value);

export const formatPercent = (locale: string, value: number) =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + "%";

export const formatTime = (locale: string, iso: string) =>
  new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export const formatDateTime = (locale: string, iso: string) =>
  new Intl.DateTimeFormat(locale, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));

export const formatDay = (locale: string, day: string) =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(
    new Date(`${day}T00:00:00Z`),
  );

/** Relative time from now, e.g. "3 minutes ago" / "fra 2 ore". */
export function formatRelative(locale: string, iso: string): string {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const deltaSeconds = (Date.parse(iso) - Date.now()) / 1000;
  const units: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
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

/**
 * A duration in minutes rendered with the locale's own unit words, stepping up
 * to hours and days so "1440 min" never reaches an operator.
 */
export function formatDuration(locale: string, minutes: number): string {
  const inUnit = (unit: string, value: number) =>
    new Intl.NumberFormat(locale, {
      style: "unit", unit, unitDisplay: "short",
    }).format(value);

  if (minutes < 60) return inUnit("minute", Math.round(minutes));
  const hours = minutes / 60;
  if (hours < 24) return inUnit("hour", Math.round(hours * 10) / 10);
  return inUnit("day", Math.round((hours / 24) * 10) / 10);
}

/**
 * A base URL as the operator reads it: just the host. Falls back to the raw
 * string when it does not parse, so a half-typed service still shows what was
 * entered rather than nothing. Port of providers.js:119-123's own `hostOf`.
 *
 * Shared rather than duplicated: `Providers` and `Settings` each carried a
 * byte-identical private copy.
 */
export const hostOf = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
};
