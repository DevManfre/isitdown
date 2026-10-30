import { Router } from "express";
import type { UiRuntimeCore } from "../runtime.ts";
import { querySchema } from "./incidentQuery.ts";

/** Per group: the palette shows a handful, and one chatty provider must not fill it. */
const GROUP_LIMIT = 8;
/** A single letter matches nearly every row there is, which is a listing, not a search. */
const MIN_QUERY_LENGTH = 2;

/**
 * One free-text search over what an operator or a provider wrote — roadmap 4.15.
 *
 * Incident titles, the operator's notes on incidents and the timeline
 * annotations are three tables, and the palette asking for each in turn would
 * be three round trips per keystroke. Component names are not here: the
 * dashboard already holds them in the status it renders, so the browser
 * matches those itself.
 *
 * Scoped to the enabled providers like the incident list: a provider nobody is
 * watching is not news, and its notes are no more so.
 */
export function searchRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  router.get("/search", async (req, res) => {
    const query = querySchema.parse(req.query["q"] ?? undefined);
    if (query.length < MIN_QUERY_LENGTH) {
      res.json({ query, incidents: [], notes: [], annotations: [] });
      return;
    }

    const providerIds = runtime.enabledProviderIds();
    const [incidents, notes, annotations] = await Promise.all([
      runtime.store.listIncidents({ providerIds, query, limit: GROUP_LIMIT }),
      runtime.store.searchIncidentNotes(query, providerIds, GROUP_LIMIT),
      runtime.store.searchAnnotations(query, providerIds, GROUP_LIMIT),
    ]);

    res.json({ query, incidents, notes, annotations });
  });

  return router;
}
