import { Router } from "express";
import { z } from "zod";
import { dayStart, resolveZone, shiftDay, zonedDayKey } from "../calendarDays.ts";
import { ANNOTATION_COLOURS } from "../historyStore.interface.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { ALLOWED_DAYS, CALENDAR_DAYS, parseDays, parseWindow } from "./historyWindow.ts";

/**
 * One marker (roadmap 12.1). The label is capped at a line: this is "v2.4.0
 * shipped", not a changelog, and a field with no ceiling is one somebody
 * eventually pastes release notes into.
 */
const annotationSchema = z.object({
  at: z.string().datetime({ offset: true }),
  label: z.string().trim().min(1).max(120),
  colour: z.enum(ANNOTATION_COLOURS),
  /** Absent means the whole fleet, which a deploy usually is. */
  providerId: z.string().min(1).optional(),
});

/**
 * Pre-aggregated history. The frontend never re-derives a percentage or a daily
 * bucket from raw samples: both the uptime bars and the incident timeline come
 * from here, so the two views cannot disagree about a window.
 */
export function historyRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  /**
   * A year of day cells for one provider — roadmap 5.20. Fixed at
   * `CALENDAR_DAYS` rather than taking a `days`: the calendar is one view with
   * one window, and the window it draws is in the answer so a stored response
   * still says what it covers.
   */
  router.get("/history/calendar", async (req, res) => {
    const provider = req.query["provider"];
    if (typeof provider !== "string" || provider === "") {
      res.status(400).json({ error: { message: "provider is required" } });
      return;
    }
    if (!runtime.listAllServices().some((service) => service.id === provider)) {
      res.status(404).json({ error: { message: `unknown provider: ${provider}` } });
      return;
    }
    res.json(await runtime.history.getProviderCalendar(provider, CALENDAR_DAYS));
  });

  router.get("/history/components", async (req, res) => {
    const days = parseDays(req.query["days"] ?? undefined);
    if (days === null) {
      res.status(400).json({ error: { message: `days must be one of ${ALLOWED_DAYS.join(", ")}` } });
      return;
    }
    const provider = req.query["provider"];
    if (typeof provider !== "string" || provider === "") {
      res.status(400).json({ error: { message: "provider is required" } });
      return;
    }
    const service = runtime.listAllServices().find((entry) => entry.id === provider);
    if (service === undefined) {
      res.status(404).json({ error: { message: `unknown provider: ${provider}` } });
      return;
    }
    res.json({
      provider,
      days,
      components: await runtime.history.getComponentHistories(provider, service.components, days),
    });
  });

  /**
   * The three fixed windows, or an arbitrary `from`/`to` range (roadmap 5.5).
   * Both answer the same shape: the range picker is another way of asking for a
   * window, not another endpoint with its own payload for the charts to learn.
   */
  router.get("/history", async (req, res) => {
    const window = parseWindow({
      days: req.query["days"] ?? undefined,
      from: req.query["from"] ?? undefined,
      to: req.query["to"] ?? undefined,
    });
    if ("error" in window) {
      res.status(400).json({ error: { message: window.error } });
      return;
    }
    const { days, endDay } = window;

    const { intervalMinutes } = (await runtime.configSource.load()).polling;
    const provider = req.query["provider"];

    if (typeof provider === "string" && provider !== "") {
      const known = runtime.listAllServices().some((service) => service.id === provider);
      if (!known) {
        res.status(404).json({ error: { message: `unknown provider: ${provider}` } });
        return;
      }
      res.json(await runtime.history.getProviderHistory(provider, days, intervalMinutes, endDay));
      return;
    }

    // The fleet-wide view of what is being watched: a disabled provider leaves
    // the table and stops moving the aggregate, but keeps its stored history for
    // the day it is switched back on.
    res.json(
      await runtime.history.getSummary(days, intervalMinutes, runtime.enabledProviderIds(), endDay),
    );
  });

  /**
   * The operator's own markers — roadmap 12.1.
   *
   * On the history router rather than a router of its own because a marker is
   * only ever read beside a window of history, and the two answer the same
   * question from either side: what happened, and what did we do.
   */
  router.get("/annotations", async (req, res) => {
    const window = parseWindow({
      days: req.query["days"] ?? undefined,
      from: req.query["from"] ?? undefined,
      to: req.query["to"] ?? undefined,
    });
    if ("error" in window) {
      res.status(400).json({ error: { message: window.error } });
      return;
    }
    const provider = req.query["provider"];
    if (provider !== undefined && typeof provider !== "string") {
      res.status(400).json({ error: { message: "provider must be a single value" } });
      return;
    }
    const zone = resolveZone(runtime.timeZone());
    const endDay = window.endDay ?? zonedDayKey(new Date(), zone);
    // The same seams the buckets use, so a marker and the bar it sits over are
    // measured against one definition of a day.
    res.json({
      annotations: await runtime.store.listAnnotations(
        dayStart(shiftDay(endDay, -(window.days - 1)), zone).toISOString(),
        dayStart(shiftDay(endDay, 1), zone).toISOString(),
        provider === "" ? undefined : provider,
      ),
    });
  });

  router.post("/annotations", async (req, res) => {
    const parsed = annotationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          message: `an annotation needs an ISO timestamp, a label of 1 to 120 characters and one of ${ANNOTATION_COLOURS.join(", ")}`,
        },
      });
      return;
    }
    const { at, label, colour, providerId } = parsed.data;
    // Checked rather than constrained by a foreign key: the row deliberately
    // outlives the provider (see the migration), so the check belongs here,
    // where a typo in a url can still be reported as one.
    if (providerId !== undefined && !runtime.listAllServices().some((service) => service.id === providerId)) {
      res.status(404).json({ error: { message: `unknown provider: ${providerId}` } });
      return;
    }
    res.status(201).json(
      await runtime.store.addAnnotation({
        at: new Date(at).toISOString(),
        label,
        colour,
        providerId: providerId ?? null,
      }),
    );
  });

  router.delete("/annotations/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: { message: "an annotation id is a number" } });
      return;
    }
    if (!(await runtime.store.deleteAnnotation(id))) {
      res.status(404).json({ error: { message: `unknown annotation: ${id}` } });
      return;
    }
    res.status(204).end();
  });

  return router;
}
