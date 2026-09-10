import { Router, type Request, type Response } from "express";
import { toCsv } from "../csv.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { ALLOWED_DAYS, parseDays } from "./historyWindow.ts";
import { readIncidentQuery } from "./incidentQuery.ts";

/**
 * CSV and JSON exports of what the dashboard already shows (roadmap 4.6).
 *
 * Everything the UI edition knows lives in one SQLite file, which makes
 * "report last quarter's uptime to someone who does not have the dashboard" a
 * question the dashboard cannot answer. These four endpoints answer it with the
 * same queries the views run — the incident export reads the incident search's
 * own filter (`readIncidentQuery`) and the history export the same aggregation
 * the charts are drawn from — so an export can never disagree with the screen
 * it was taken from.
 *
 * The rows are served as a download rather than rendered, because a browser
 * that displays a CSV inline is a browser the operator then has to save from by
 * hand.
 */

/**
 * Rows one export may carry. A ten-year retention over a large fleet is
 * unbounded, and a response that has to be buffered to be counted should not be
 * either. Hitting it is reported rather than silently trimmed — a truncated
 * uptime report that looks complete is worse than no report.
 */
const MAX_ROWS = 20_000;
const TRUNCATED_HEADER = "X-IsItDown-Truncated";

export function exportRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  const incidents = (format: "csv" | "json") => async (req: Request, res: Response) => {
    const { provider, state, query, days, filter } = readIncidentQuery(req.query, runtime);
    const rows = await runtime.store.listIncidents({
      ...filter,
      ...(state === "all" ? {} : { state }),
      limit: MAX_ROWS,
    });
    const truncated = rows.length === MAX_ROWS;
    if (truncated) res.setHeader(TRUNCATED_HEADER, "true");

    const name = `incidents${provider === null ? "" : `-${provider}`}`;
    if (format === "csv") {
      send(res, "csv", name, "text/csv; charset=utf-8", incidentsCsv(rows));
      return;
    }
    send(
      res,
      "json",
      name,
      "application/json; charset=utf-8",
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          filter: { provider, state, query: query === "" ? null : query, days: days === 0 ? null : days },
          count: rows.length,
          truncated,
          incidents: rows,
        },
        null,
        2,
      )}\n`,
    );
  };

  const history = (format: "csv" | "json") => async (req: Request, res: Response) => {
    const days = parseDays(req.query["days"] ?? undefined);
    if (days === null) {
      res.status(400).json({ error: { message: `days must be one of ${ALLOWED_DAYS.join(", ")}` } });
      return;
    }

    const { intervalMinutes } = (await runtime.configSource.load()).polling;
    const provider = req.query["provider"];
    const scoped = typeof provider === "string" && provider !== "" ? provider : null;

    if (scoped !== null && !runtime.listAllServices().some((service) => service.id === scoped)) {
      res.status(404).json({ error: { message: `unknown provider: ${scoped}` } });
      return;
    }

    // One provider or the whole fleet, from the same two calls `/history`
    // serves the charts with: a disabled provider leaves the fleet export the
    // way it leaves the table, and is still exportable by name.
    const histories =
      scoped === null
        ? (await runtime.history.getSummary(days, intervalMinutes, runtime.enabledProviderIds())).providers
        : [await runtime.history.getProviderHistory(scoped, days, intervalMinutes)];

    const name = `history-${days}d${scoped === null ? "" : `-${scoped}`}`;
    if (format === "csv") {
      send(res, "csv", name, "text/csv; charset=utf-8", historyCsv(histories));
      return;
    }
    send(
      res,
      "json",
      name,
      "application/json; charset=utf-8",
      `${JSON.stringify({ generatedAt: new Date().toISOString(), days, providers: histories }, null, 2)}\n`,
    );
  };

  // Two paths per resource rather than one with a `format` parameter: the
  // extension in the url is what makes the downloaded file open in the right
  // application, and Express 5 no longer accepts an inline pattern to constrain
  // the parameter to the two formats that exist.
  router.get("/export/incidents.csv", incidents("csv"));
  router.get("/export/incidents.json", incidents("json"));
  router.get("/export/history.csv", history("csv"));
  router.get("/export/history.json", history("json"));

  return router;
}

/** `isitdown-incidents-2026-09-09.csv`: dated, so two exports never collide in a downloads folder. */
function send(
  res: Response,
  format: "csv" | "json",
  name: string,
  contentType: string,
  body: string,
): void {
  const day = new Date().toISOString().slice(0, 10);
  res.setHeader("content-type", contentType);
  res.setHeader("content-disposition", `attachment; filename="isitdown-${name}-${day}.${format}"`);
  res.send(body);
}

function incidentsCsv(rows: Awaited<ReturnType<UiRuntimeCore["store"]["listIncidents"]>>): string {
  return toCsv(
    ["provider_id", "incident_id", "name", "impact", "status", "started_at", "updated_at", "resolved_at"],
    rows.map((row) => [
      row.providerId,
      row.incidentId,
      row.name,
      row.impact,
      row.status,
      row.startedAt,
      row.updatedAt,
      row.resolvedAt,
    ]),
  );
}

/**
 * One row per provider per day: the status the day is coloured by beside the
 * uptime the bar is drawn from. Both, because a worst-status cannot say how
 * much of the day was up and a percentage cannot say what went wrong.
 */
function historyCsv(
  histories: Awaited<ReturnType<UiRuntimeCore["history"]["getProviderHistory"]>>[],
): string {
  return toCsv(
    ["provider_id", "day", "worst_status", "uptime_pct"],
    histories.flatMap((history) => {
      const uptimeByDay = new Map(history.dailySeries.map((entry) => [entry.day, entry.uptime]));
      return history.buckets.map((bucket) => [
        history.providerId,
        bucket.day,
        bucket.status,
        uptimeByDay.get(bucket.day) ?? null,
      ]);
    }),
  );
}
