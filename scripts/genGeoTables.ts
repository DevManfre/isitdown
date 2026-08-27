// scripts/genGeoTables.ts
//
// One-time dev step, never part of `npm run build`: downloads OurAirports'
// public-domain airport table and reduces it to the IATA → lat/lon map the
// resolver needs. The output JSON is committed; the network is touched only
// when someone deliberately refreshes it.
//
// Run: node --experimental-strip-types scripts/genGeoTables.ts
import { writeFileSync } from "node:fs";

const SOURCE = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const OUT = new URL("../src/ui/geo/iata.json", import.meta.url);

/** Splits one CSV line, honouring the double-quoted fields OurAirports uses. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i] as string;
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`airports.csv fetch failed: HTTP ${response.status}`);

const lines = (await response.text()).split("\n").filter((line) => line.trim() !== "");
const header = splitCsvLine(lines[0] as string);
const col = (name: string): number => {
  const index = header.indexOf(name);
  if (index === -1) throw new Error(`airports.csv has no "${name}" column`);
  return index;
};
const [iataAt, latAt, lonAt, typeAt] = [
  col("iata_code"),
  col("latitude_deg"),
  col("longitude_deg"),
  col("type"),
];

const table: Record<string, { lat: number; lon: number }> = {};
for (const line of lines.slice(1)) {
  const fields = splitCsvLine(line);
  const code = (fields[iataAt] ?? "").trim().toUpperCase();
  // A closed airport keeps its code in the file; a provider naming a live PoP
  // never means one, and keeping it only adds a chance of a wrong hit.
  if (!/^[A-Z]{3}$/.test(code) || fields[typeAt] === "closed") continue;
  const lat = Number(fields[latAt]);
  const lon = Number(fields[lonAt]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  // First wins: the file is sorted so the larger airport for a shared code
  // comes first, and a later duplicate is the lesser one.
  table[code] ??= { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
}

writeFileSync(OUT, `${JSON.stringify(table)}\n`);
console.log(`wrote ${Object.keys(table).length} IATA codes`);
