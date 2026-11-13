import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import { guardedFetch, readCapped, readOutboundPolicy } from "../core/outboundPolicy.ts";
import { USER_AGENT } from "../core/http.ts";

/**
 * The operator's own metric, drawn under the providers' incidents — roadmap 6.11.
 * "Is it us or Cloudflare?" is answered by eye when the error rate of the
 * operator's app climbs in the same minutes a provider's bar turns red, or
 * does not.
 *
 * Two sources:
 *
 * - `prometheus` — a PromQL query against a Prometheus-compatible server
 *   (Prometheus, Thanos, VictoriaMetrics, Mimir), read with `query_range` each
 *   time the chart is drawn. Nothing is copied: Prometheus already keeps the
 *   series, and a second copy here would go stale.
 * - `csv` — `timestamp,value` rows the operator uploads once. Stored, because
 *   nowhere else has them.
 *
 * Either way the series is the operator's data about the operator's systems.
 * It never goes to a notifier and never reaches the diff engine: this is a
 * picture to compare against, not a signal.
 */

export const SERIES_SOURCES = ["prometheus", "csv"] as const;
export type SeriesSource = (typeof SERIES_SOURCES)[number];

/** Optional bearer token for a Prometheus behind auth (env or secrets file). */
export const PROMETHEUS_TOKEN_ENV = "PROMETHEUS_TOKEN";

/** A CSV upload is a few months of a metric, not a data warehouse. */
export const MAX_CSV_POINTS = 50_000;
/** The chart is a few hundred pixels wide; more points than this draw nothing new. */
const TARGET_POINTS = 300;
const MAX_SERIES = 10;
const QUERY_TIMEOUT_MS = 15_000;

export interface OperatorSeries {
  id: number;
  name: string;
  /** Free text shown on the axis, e.g. "%" or "req/s". Empty for none. */
  unit: string;
  source: SeriesSource;
  /** `prometheus` only. */
  url: string | null;
  query: string | null;
  /** `csv` only: how many points were uploaded. */
  points: number;
  createdAt: string;
}

export interface SeriesPoint {
  /** ISO 8601, UTC. */
  at: string;
  value: number;
}

export interface SeriesReading {
  series: OperatorSeries;
  from: string;
  to: string;
  points: SeriesPoint[];
}

const nameSchema = z.string().trim().min(1).max(80);
const unitSchema = z.string().trim().max(16).default("");

export const newSeriesSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("prometheus"),
      name: nameSchema,
      unit: unitSchema,
      url: z.string().trim().url().max(2048),
      query: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      source: z.literal("csv"),
      name: nameSchema,
      unit: unitSchema,
      csv: z.string().min(1).max(4_000_000),
    })
    .strict(),
]);
export type NewSeries = z.infer<typeof newSeriesSchema>;

const seriesRowSchema = z.object({
  id: z.number(),
  name: z.string(),
  unit: z.string(),
  source: z.enum(SERIES_SOURCES),
  url: z.string().nullable(),
  query: z.string().nullable(),
  points: z.number(),
  created_at: z.string(),
});

/**
 * `timestamp,value` per line. The timestamp is ISO 8601 or Unix seconds (or
 * milliseconds, told apart by size); a header row, blank lines and `#`
 * comments are skipped. A row that cannot be read is an error naming its line,
 * not a silent skip: a chart missing a week because one cell said "n/a" would
 * be a wrong picture nobody was told about.
 */
export function parseSeriesCsv(text: string): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const cells = line.split(/[,;\t]/).map((cell) => cell.trim().replace(/^"|"$/g, ""));
    if (cells.length < 2) throw new Error(`line ${index + 1}: expected "timestamp,value"`);
    const [stamp = "", rawValue = ""] = cells;
    const value = Number(rawValue);
    const at = parseStamp(stamp);
    if (at === null || !Number.isFinite(value)) {
      // The first row is allowed to be a header.
      if (points.length === 0 && index === lines.findIndex((entry) => entry.trim() !== "" && !entry.trim().startsWith("#"))) continue;
      throw new Error(`line ${index + 1}: cannot read "${line.slice(0, 60)}" as a time and a number`);
    }
    points.push({ at, value });
    if (points.length > MAX_CSV_POINTS) throw new Error(`more than ${MAX_CSV_POINTS} rows; downsample it first`);
  }
  if (points.length === 0) throw new Error("no rows to import");
  return points.sort((a, b) => a.at.localeCompare(b.at));
}

function parseStamp(stamp: string): string | null {
  if (/^\d{9,13}(\.\d+)?$/.test(stamp)) {
    const number = Number(stamp);
    const ms = number > 1e11 ? number : number * 1000;
    return new Date(ms).toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(stamp)) return null;
  const ms = Date.parse(stamp);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function listSeries(db: DatabaseSync): OperatorSeries[] {
  return db
    .prepare(
      `SELECT s.id, s.name, s.unit, s.source, s.url, s.query, s.created_at,
              (SELECT COUNT(*) FROM operator_points p WHERE p.series_id = s.id) AS points
         FROM operator_series s ORDER BY s.id`,
    )
    .all()
    .map((row) => seriesRowSchema.parse(row))
    .map((row) => ({
      id: row.id,
      name: row.name,
      unit: row.unit,
      source: row.source,
      url: row.url,
      query: row.query,
      points: row.points,
      createdAt: row.created_at,
    }));
}

export function addSeries(db: DatabaseSync, input: NewSeries, now = new Date()): OperatorSeries {
  if (listSeries(db).length >= MAX_SERIES) throw new Error(`at most ${MAX_SERIES} series`);
  const points = input.source === "csv" ? parseSeriesCsv(input.csv) : [];
  db.exec("BEGIN");
  try {
    const result = db
      .prepare("INSERT INTO operator_series (name, unit, source, url, query, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        input.name,
        input.unit,
        input.source,
        input.source === "prometheus" ? input.url : null,
        input.source === "prometheus" ? input.query : null,
        now.toISOString(),
      );
    const id = Number(result.lastInsertRowid);
    const insert = db.prepare("INSERT OR REPLACE INTO operator_points (series_id, at, value) VALUES (?, ?, ?)");
    for (const point of points) insert.run(id, point.at, point.value);
    db.exec("COMMIT");
    return listSeries(db).find((series) => series.id === id) as OperatorSeries;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function removeSeries(db: DatabaseSync, id: number): boolean {
  return Number(db.prepare("DELETE FROM operator_series WHERE id = ?").run(id).changes) > 0;
}

/** Evenly spaced buckets, each keeping its largest value: a spike must survive the thinning. */
export function thin(points: SeriesPoint[], target = TARGET_POINTS): SeriesPoint[] {
  if (points.length <= target) return points;
  const size = Math.ceil(points.length / target);
  const out: SeriesPoint[] = [];
  for (let start = 0; start < points.length; start += size) {
    const bucket = points.slice(start, start + size);
    out.push(bucket.reduce((max, point) => (point.value > max.value ? point : max)));
  }
  return out;
}

const promRangeSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    resultType: z.literal("matrix"),
    result: z.array(z.object({ values: z.array(z.tuple([z.number(), z.string()])) })),
  }),
});

const promErrorSchema = z.object({ status: z.literal("error"), error: z.string().optional() });

export interface PromDeps {
  env: NodeJS.ProcessEnv;
  /** Seam for tests; production checks the target against the outbound policy. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

/**
 * One `query_range` over the window, stepped so the answer is about
 * `TARGET_POINTS` long. A query that returns several series is refused rather
 * than drawn as one: summing or picking would be a choice made for the
 * operator, and `sum(...)` in the query is the honest way to make it.
 */
export async function queryPrometheus(series: OperatorSeries, from: Date, to: Date, deps: PromDeps): Promise<SeriesPoint[]> {
  if (series.url === null || series.query === null) throw new Error("not a Prometheus series");
  const step = Math.max(15, Math.ceil((to.getTime() - from.getTime()) / 1000 / TARGET_POINTS));
  const url = new URL(`${series.url.replace(/\/+$/, "")}/api/v1/query_range`);
  url.searchParams.set("query", series.query);
  url.searchParams.set("start", String(Math.floor(from.getTime() / 1000)));
  url.searchParams.set("end", String(Math.floor(to.getTime() / 1000)));
  url.searchParams.set("step", String(step));
  const token = deps.env[PROMETHEUS_TOKEN_ENV];
  const init: RequestInit = {
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
      ...(token === undefined || token === "" ? {} : { authorization: `Bearer ${token}` }),
    },
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  };
  const response = deps.fetch
    ? await deps.fetch(url.toString(), init)
    : await guardedFetch(url.toString(), init, readOutboundPolicy(deps.env), true);
  const text = new TextDecoder().decode(await readCapped(response, 4 * 1024 * 1024));
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Prometheus answered HTTP ${response.status} with something that is not JSON`);
  }
  const failed = promErrorSchema.safeParse(body);
  if (failed.success) throw new Error(`Prometheus refused the query: ${failed.data.error ?? "no reason given"}`);
  if (!response.ok) throw new Error(`Prometheus answered HTTP ${response.status}`);
  const parsed = promRangeSchema.safeParse(body);
  if (!parsed.success) throw new Error("Prometheus did not answer with a range vector");
  const results = parsed.data.data.result;
  if (results.length > 1) throw new Error(`the query returns ${results.length} series; aggregate it to one, e.g. sum(...)`);
  return (results[0]?.values ?? []).flatMap(([seconds, raw]) => {
    const value = Number(raw);
    return Number.isFinite(value) ? [{ at: new Date(seconds * 1000).toISOString(), value }] : [];
  });
}

export function csvPoints(db: DatabaseSync, id: number, from: Date, to: Date): SeriesPoint[] {
  return db
    .prepare("SELECT at, value FROM operator_points WHERE series_id = ? AND at >= ? AND at <= ? ORDER BY at")
    .all(id, from.toISOString(), to.toISOString())
    .map((row) => z.object({ at: z.string(), value: z.number() }).parse(row));
}

export async function readSeries(db: DatabaseSync, id: number, from: Date, to: Date, deps: PromDeps): Promise<SeriesReading | null> {
  const series = listSeries(db).find((entry) => entry.id === id);
  if (series === undefined) return null;
  const points = series.source === "prometheus" ? await queryPrometheus(series, from, to, deps) : csvPoints(db, id, from, to);
  return { series, from: from.toISOString(), to: to.toISOString(), points: thin(points) };
}
