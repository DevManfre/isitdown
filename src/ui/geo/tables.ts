// src/ui/geo/tables.ts
import { z } from "zod";
import iataJson from "./iata.json" with { type: "json" };
import regionsJson from "./cloudRegions.json" with { type: "json" };

const latLonSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const geoTablesSchema = z.object({
  iata: z.record(z.string().regex(/^[A-Z]{3}$/), latLonSchema),
  regions: z.record(z.string().min(1), latLonSchema),
});

export type LatLon = z.infer<typeof latLonSchema>;
export type GeoTables = z.infer<typeof geoTablesSchema>;

/**
 * Validates the committed tables at load. Both are generated or hand-edited
 * files, which makes them external input like any provider payload: a string
 * latitude or an out-of-range longitude must fail here rather than place a
 * marker at `NaN` on the map.
 *
 * The argument exists for the test suite, which needs to prove the guard
 * rejects a bad table without editing a committed file.
 */
export function loadGeoTables(raw?: unknown): GeoTables {
  return geoTablesSchema.parse(raw ?? { iata: iataJson, regions: regionsJson });
}
