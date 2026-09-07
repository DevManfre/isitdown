/**
 * Which zone the dashboard renders clock times in.
 *
 * Everything used to be shown in whatever zone the browser happened to be in,
 * which is right until it is not: an operator on a laptop that travels, or one
 * reading a dashboard hosted somewhere else, wants to be able to say "show me
 * UTC" (or Europe/Rome) and have every timestamp on the page agree.
 *
 * It is a module-level value rather than a prop or a context for the same
 * reason `i18n.language` is: every formatter in `format.ts` needs it, they are
 * called from dozens of places, and threading a zone through all of them would
 * be a rename of every call site for a value that changes about once a year.
 *
 * `auto` — the default — is the browser's own zone, and is stored as the
 * *absence* of a choice so a preference set on one machine does not pin another
 * machine to that machine's zone.
 */

const AUTO = "auto";

let chosen: string | undefined;

/**
 * Applies a preference. An unusable zone name is ignored rather than thrown:
 * a bad value in the database must not take the dashboard down, and the
 * browser's own zone is always a safe answer.
 */
export function setTimeZone(value: string | null | undefined): void {
  if (value === null || value === undefined || value === AUTO || value === "") {
    chosen = undefined;
    return;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    chosen = value;
  } catch {
    chosen = undefined;
  }
}

/** The chosen zone, or undefined when the browser's own is in use. */
export const timeZone = (): string | undefined => chosen;

/** The zone the operator is actually looking at, named — for a footnote or a label. */
export const effectiveTimeZone = (): string =>
  chosen ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Spread into an `Intl.DateTimeFormat` options object. Empty when no zone was
 * chosen, which is exactly "use the browser's".
 */
export const zoneOptions = (): { timeZone?: string } => (chosen === undefined ? {} : { timeZone: chosen });

/**
 * The zones offered in the settings picker.
 *
 * `Intl.supportedValuesOf("timeZone")` returns some 400 names, which is a
 * scroll rather than a choice — and the operator of a single-tenant dashboard
 * is in one place. So: UTC first, then the zones that cover the bulk of
 * self-hosting, and the browser's own is always available as `auto`. Anything
 * else can still be stored through the API, and the picker shows it because the
 * stored value is the select's own value.
 */
export const TIME_ZONES = [
  "UTC",
  "Europe/London",
  "Europe/Rome",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Warsaw",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Jerusalem",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;
