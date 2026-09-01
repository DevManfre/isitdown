import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { OverallStatus } from "../core/types.ts";
import type { GeoSource } from "./geo/resolveLocation.ts";

export interface StoredMapPoint {
  providerId: string;
  componentId: string;
  name: string;
  lat: number;
  lon: number;
  source: GeoSource;
  status: OverallStatus;
  observedAt: string;
}

export interface StoredGeoState {
  providerId: string;
  located: number;
  total: number;
  checkedAt: string;
}

/**
 * Rows come back from SQLite untyped, and a column read is external input like a
 * provider's JSON is. Validating here rather than casting means a schema drift
 * shows up as a clear error instead of an `undefined` three layers away.
 */
const pointRowSchema = z.object({
  provider_id: z.string(),
  component_id: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  source: z.enum(["iata", "region"]),
  status: z.enum(["operational", "degraded", "partial_outage", "major_outage", "unknown"]),
  observed_at: z.string(),
});

const geoStateRowSchema = z.object({
  provider_id: z.string(),
  located: z.number(),
  total: z.number(),
  checked_at: z.string(),
});

const componentIdRowSchema = z.object({ component_id: z.string() });

export interface MapStore {
  /**
   * Replaces a provider's whole snapshot, in one transaction: delete what it no
   * longer lists, upsert what it does. A provider that renames or retires a PoP
   * must not leave a stale marker behind on the map.
   */
  replaceProvider(
    providerId: string,
    points: Omit<StoredMapPoint, "providerId">[],
    state: Omit<StoredGeoState, "providerId">,
  ): void;
  listPoints(): StoredMapPoint[];
  listGeoState(): StoredGeoState[];
}

export function createMapStore(db: DatabaseSync): MapStore {
  // Foreign keys are off by default in SQLite, and the cascade that clears a
  // deleted provider's markers depends on them. `openDatabase` already turns
  // this on for every caller in this codebase, but the store guarantees its
  // own invariant rather than trusting the caller's pragmas.
  db.exec("PRAGMA foreign_keys = ON");

  const upsertPoint = db.prepare(
    `INSERT INTO map_points (provider_id, component_id, name, lat, lon, source, status, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider_id, component_id) DO UPDATE SET
       name = excluded.name, lat = excluded.lat, lon = excluded.lon,
       source = excluded.source, status = excluded.status, observed_at = excluded.observed_at`,
  );
  const upsertState = db.prepare(
    `INSERT INTO map_geo_state (provider_id, located, total, checked_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (provider_id) DO UPDATE SET
       located = excluded.located, total = excluded.total, checked_at = excluded.checked_at`,
  );
  const selectComponentIds = db.prepare("SELECT component_id FROM map_points WHERE provider_id = ?");
  const deletePoint = db.prepare("DELETE FROM map_points WHERE provider_id = ? AND component_id = ?");

  return {
    replaceProvider(providerId, points, state) {
      const keep = new Set(points.map((point) => point.componentId));
      db.exec("BEGIN");
      try {
        // Delete-then-upsert rather than delete-all-then-insert: an unchanged
        // component keeps its row updated in place instead of being torn down
        // and rebuilt on every poll, which is the cheaper write and leaves no
        // window where a still-current marker is briefly gone.
        const existingIds = selectComponentIds
          .all(providerId)
          .map((row) => componentIdRowSchema.parse(row).component_id);
        for (const componentId of existingIds) {
          if (!keep.has(componentId)) {
            deletePoint.run(providerId, componentId);
          }
        }
        for (const point of points) {
          upsertPoint.run(
            providerId,
            point.componentId,
            point.name,
            point.lat,
            point.lon,
            point.source,
            point.status,
            point.observedAt,
          );
        }
        upsertState.run(providerId, state.located, state.total, state.checkedAt);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    listPoints() {
      return db
        .prepare(
          `SELECT provider_id, component_id, name, lat, lon, source, status, observed_at
           FROM map_points ORDER BY provider_id, component_id`,
        )
        .all()
        .map((row) => pointRowSchema.parse(row))
        .map((row) => ({
          providerId: row.provider_id,
          componentId: row.component_id,
          name: row.name,
          lat: row.lat,
          lon: row.lon,
          source: row.source,
          status: row.status,
          observedAt: row.observed_at,
        }));
    },

    listGeoState() {
      return db
        .prepare("SELECT provider_id, located, total, checked_at FROM map_geo_state ORDER BY provider_id")
        .all()
        .map((row) => geoStateRowSchema.parse(row))
        .map((row) => ({
          providerId: row.provider_id,
          located: row.located,
          total: row.total,
          checkedAt: row.checked_at,
        }));
    },
  };
}
