/**
 * CSV serialisation for the exports (roadmap 4.6).
 *
 * RFC 4180: fields are quoted only when they need to be, an embedded quote is
 * doubled, and rows end with CRLF — which is what the spec says and what
 * spreadsheets expect. A provider's incident name is arbitrary upstream text,
 * so it is the one field that reliably contains commas, quotes and newlines.
 */
const NEEDS_QUOTING = /[",\r\n]/;

function field(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return NEEDS_QUOTING.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (string | number | null)[][]): string {
  return [header, ...rows].map((row) => row.map(field).join(",")).join("\r\n") + "\r\n";
}
