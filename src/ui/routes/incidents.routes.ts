import { Router } from "express";
import type { IncidentRow } from "../historyStore.interface.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { pageSchema, pageSizeSchema, readIncidentQuery } from "./incidentQuery.ts";

/** How many recent polls the incident view's strip shows. */
const POLL_STRIP_SIZE = 24;
const ACTION_LOG_LIMIT = 50;
interface TimelineEntry {
  at: string;
  label: string;
  status?: string | undefined;
}

/**
 * The incident list and one incident's detail.
 *
 * The timeline is built from what IsItDown actually observed — when the
 * incident first appeared, the status transitions its polls recorded, and when it
 * disappeared — rather than from the provider's own update feed, which the
 * adapter does not normalise. Showing our own observations is honest and needs no
 * extra upstream call.
 */
export function incidentsRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  /**
   * One page of the incident list, plus the two things a page cannot tell the
   * dashboard about itself.
   *
   * `counts` carries all three states whatever the filter, because the view's
   * filter pills show every count while only one state is on screen — derived
   * from the loaded rows they would report the page size instead. `active` is
   * the hero card's own data: it stays on screen under every filter and on
   * every page, so it cannot be carved out of the page.
   *
   * That is three statements per request and no more: the page, the counts (one
   * statement for all three), and the short active list.
   */
  router.get("/incidents", async (req, res) => {
    // The search and the window narrow the page *and* the counts, so the pills
    // report what the search found rather than what the fleet has ever had.
    // The active list below is deliberately outside them: it is the hero card's
    // data, and a card that vanished while an operator typed a search would
    // read as "the incident resolved itself".
    const { provider, state, filter } = readIncidentQuery(req.query, runtime);
    const page = pageSchema.parse(req.query["page"] ?? undefined);
    const pageSize = pageSizeSchema.parse(req.query["pageSize"] ?? undefined);
    const activeScope = {
      ...(provider === null ? {} : { providerId: provider }),
      providerIds: runtime.enabledProviderIds(),
    };

    const [active, items, counts] = await Promise.all([
      runtime.store.listIncidents({ ...activeScope, state: "active" }),
      runtime.store.listIncidents({
        ...filter,
        ...(state === "all" ? {} : { state }),
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
      runtime.store.countIncidents(filter),
    ]);

    res.json({ active, page: { items, page, pageSize, total: counts[state] }, counts });
  });

  router.get("/incidents/:providerId/:incidentId", async (req, res) => {
    const { providerId, incidentId } = req.params;
    const incident = await runtime.store.getIncident(providerId, incidentId);
    if (incident === null) {
      res.status(404).json({ error: { message: `unknown incident: ${providerId}/${incidentId}` } });
      return;
    }

    const [polls, notifications, active] = await Promise.all([
      runtime.store.getRecentSamples(providerId, POLL_STRIP_SIZE),
      runtime.store.listNotifications(ACTION_LOG_LIMIT),
      runtime.store.listIncidents({ providerId, state: "active" }),
    ]);

    res.json({
      incident,
      timeline: buildTimeline(incident, polls),
      actionLog: notifications.filter((record) => record.providerId === providerId),
      polls,
      otherActiveIncidents: active.filter((row) => row.incidentId !== incidentId),
    });
  });

  return router;
}

function buildTimeline(
  incident: IncidentRow,
  polls: { observedAt: string; overallStatus: string }[],
): TimelineEntry[] {
  const timeline: TimelineEntry[] = [
    { at: incident.startedAt, label: "opened", status: incident.status },
  ];

  // Oldest first, keeping only the polls where the observed status actually moved.
  const ordered = [...polls].reverse();
  let previous: string | undefined;
  for (const poll of ordered) {
    if (poll.observedAt < incident.startedAt) {
      previous = poll.overallStatus;
      continue;
    }
    if (poll.overallStatus === previous) continue;
    previous = poll.overallStatus;
    timeline.push({ at: poll.observedAt, label: "observed", status: poll.overallStatus });
  }

  if (incident.resolvedAt !== null) {
    timeline.push({ at: incident.resolvedAt, label: "resolved" });
  }
  return timeline;
}
