import { Router, type Request, type Response } from "express";
import { incidentsIcs, incidentsRss, type FeedInput } from "../feeds.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { readIncidentQuery } from "./incidentQuery.ts";

/**
 * The incident history as an RSS feed and as a calendar — roadmap 4.9.
 *
 * The same rows the incident list pages and the CSV exports, in the one shape a
 * reader or a calendar consumes without an API client. They read the incident
 * search's own filter (`readIncidentQuery`), so a url copied out of the
 * dashboard keeps answering the question it was copied from.
 *
 * Unlike the exports these are served inline: a feed reader that is handed a
 * `content-disposition: attachment` saves the file instead of subscribing to
 * it.
 */

/**
 * How many incidents a feed carries. Fixed rather than a parameter: a reader
 * polls a stored url forever, and a feed that could be widened into the whole
 * retention window would be a second, unpaged incident API.
 */
const FEED_SIZE = 200;

export function feedsRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  const feed = (format: "xml" | "ics") => async (req: Request, res: Response) => {
    const { state, filter } = readIncidentQuery(req.query, runtime);
    const rows = await runtime.store.listIncidents({
      ...filter,
      ...(state === "all" ? {} : { state }),
      limit: FEED_SIZE,
    });

    // `req.host` honours the proxy headers Express already trusts, so a feed
    // behind a reverse proxy links back to the address the operator reached the
    // dashboard on rather than to the container's own port.
    const origin = `${req.protocol}://${req.host}`;
    const names = new Map(runtime.listAllServices().map((service) => [service.id, service.name]));
    const input: FeedInput = {
      rows,
      nameFor: (providerId) => names.get(providerId) ?? providerId,
      origin,
      generatedAt: new Date(),
      self: `${origin}${req.originalUrl}`,
    };

    if (format === "xml") {
      res.setHeader("content-type", "application/rss+xml; charset=utf-8");
      res.send(incidentsRss(input));
      return;
    }
    res.setHeader("content-type", "text/calendar; charset=utf-8");
    res.send(incidentsIcs(input));
  };

  router.get("/feeds/incidents.xml", feed("xml"));
  router.get("/feeds/incidents.ics", feed("ics"));

  return router;
}
