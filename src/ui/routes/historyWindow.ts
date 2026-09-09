/** The only windows the dashboard offers, so the only ones the API serves. */
export const ALLOWED_DAYS = [7, 30, 90] as const;
export const DEFAULT_DAYS = 90;

/**
 * Parsed by hand rather than through a coercing schema: a bad value has to be
 * told which windows exist, and a coercion failure would answer "expected
 * number, received nan" instead.
 *
 * Shared by `/history` and `/export/history.*` so the export cannot end up
 * offering a window the charts do not (roadmap 4.6).
 */
export function parseDays(raw: unknown): number | null {
  if (raw === undefined) return DEFAULT_DAYS;
  const value = Number(raw);
  return (ALLOWED_DAYS as readonly number[]).includes(value) ? value : null;
}
