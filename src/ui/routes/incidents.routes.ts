import { Router } from "express";
import type { IncidentRow } from "../historyStore.interface.ts";
import type { UiRuntimeCore } from "../runtime.ts";

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

  router.get("/incidents", async (req, res) => {
    const provider = req.query["provider"];
    const filter = typeof provider === "string" && provider !== "" ? { providerId: provider } : {};

    const [active, closed] = await Promise.all([
      runtime.store.listIncidents({ ...filter, state: "active" }),
      runtime.store.listIncidents({ ...filter, state: "resolved", limit: 100 }),
    ]);
    res.json({ active, closed });
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
