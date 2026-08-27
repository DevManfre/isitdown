// src/ui/geo/resolveLocation.ts
export { loadGeoTables, geoTablesSchema } from "./tables.ts";
export type { GeoTables, LatLon } from "./tables.ts";

import type { GeoTables } from "./tables.ts";

export type GeoSource = "iata" | "region";

export interface GeoPoint {
  lat: number;
  lon: number;
  source: GeoSource;
}

/**
 * Anchored at the end of the name and requiring a separator before the code:
 * providers write it as a suffix off the location ("Amsterdam, Netherlands -
 * (AMS)"), and without the separator any parenthesised three-letter word in
 * prose becomes a candidate — "Beta feature (NEW)" would resolve, because NEW
 * is New Orleans Lakefront. It is still only a candidate; the table decides.
 */
const IATA_SUFFIX = /[-–—]\s*\(([A-Z]{3})\)\s*$/;

/**
 * Resolves one component name to a point, or null when nothing places it.
 *
 * The cascade is ordered by precision, not by convenience. An IATA code names
 * one airfield; a cloud region names a metropolitan area whose coordinates are
 * a city centre. When a name carries both, the airfield wins.
 *
 * Tables are passed in rather than imported here so the suite can run the
 * cascade against three entries instead of nine thousand.
 */
export function resolveLocation(componentName: string, tables: GeoTables): GeoPoint | null {
  const iata = IATA_SUFFIX.exec(componentName)?.[1];
  if (iata !== undefined) {
    const hit = tables.iata[iata];
    if (hit !== undefined) return { lat: hit.lat, lon: hit.lon, source: "iata" };
  }

  // Longest key first: "us-east-1" must not be shadowed by a hypothetical
  // "us-east" entry that happens to be scanned earlier.
  const codes = Object.keys(tables.regions).sort((a, b) => b.length - a.length);
  const lowered = componentName.toLowerCase();
  for (const code of codes) {
    if (lowered.includes(code.toLowerCase())) {
      const hit = tables.regions[code] as { lat: number; lon: number };
      return { lat: hit.lat, lon: hit.lon, source: "region" };
    }
  }

  return null;
}
