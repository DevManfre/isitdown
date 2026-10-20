import { Router } from "express";
import { z } from "zod";
import { detectAdapter } from "../../adapters/detect.ts";
import { cadenceProblems, optionProblems } from "../../adapters/index.ts";
import { getAdapter } from "../../adapters/index.ts";
import {
  alertCapSchema,
  maintenanceNoticeSchema,
  escalationSchema,
  channelHealthSchema,
  digestSchema,
  pollingSchema,
  quietHoursSchema,
  serviceDefinitionSchema,
} from "../../core/config.schema.ts";
import {
  deliveryOf,
  describeChannels,
  describeRouting,
  describeServiceImpact,
  insertService,
  listRecipients,
  listRemovedServices,
  listServices,
  purgeService,
  readSettings,
  restoreDeadline,
  restoreService,
  servicePatchSchema,
  softDeleteService,
  updateService,
  writeSettings,
} from "../dbConfigSource.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { configImportExportRoutes } from "./config.importexport.routes.ts";
import { configPushRoutes } from "./config.push.routes.ts";
import { configStorageRoutes } from "./config.storage.routes.ts";
import { configChannelRoutes } from "./config.channels.routes.ts";
import { configBackupRoutes } from "./config.backup.routes.ts";
import { issues } from "./config.shared.ts";

const previewComponentsSchema = serviceDefinitionSchema.pick({
  adapter: true,
  baseUrl: true,
});

/** Whatever the operator pasted into the base url field, before it is a service. */
const detectSchema = z.object({ url: z.string().min(1).max(2048) });

/**
 * The delivery policy, patchable a field at a time. Partial at every level
 * because the dashboard's rows apply instantly and one at a time: sending the
 * whole policy to change a floor would write back four values the operator did
 * not touch, and race their own next keystroke.
 */
const deliveryPatchSchema = z.object({
  quietHours: quietHoursSchema.partial().optional(),
  digest: digestSchema.partial().optional(),
  cap: alertCapSchema.partial().optional(),
  updateInPlace: z.boolean().optional(),
  maintenanceNotice: maintenanceNoticeSchema.partial().optional(),
  escalation: escalationSchema.partial().optional(),
  channelHealth: channelHealthSchema.partial().optional(),
});

const settingsPatchSchema = pollingSchema
  .partial()
  // Retention is not a polling field and lives only in this edition: the Light
  // edition prunes nothing, so the shared schema has no business knowing it.
  .extend({
    retentionDays: z.number().int().min(7).max(3650).optional(),
    delivery: deliveryPatchSchema.optional(),
    // Roadmap 15.11a. Not part of `delivery`: it never sends a notification,
    // it just controls whether the dashboard itself reads GHCR.
    updateCheckEnabled: z.boolean().optional(),
    // Roadmap 2.2. Beside the update check, for the same reason.
    catalogFeedEnabled: z.boolean().optional(),
  });

/**
 * The delivery policy patch, flattened onto the setting rows that store it.
 * One row per field rather than a JSON blob, so an unreadable value falls back
 * on its own instead of taking the whole policy with it — see the read side in
 * `dbConfigSource`.
 */
function deliveryPatch(
  patch: z.infer<typeof deliveryPatchSchema> | undefined,
): Record<string, unknown> {
  if (patch === undefined) return {};
  const { quietHours, digest, cap, updateInPlace, maintenanceNotice, escalation, channelHealth } = patch;
  return {
    ...(quietHours?.enabled === undefined
      ? {}
      : { quietHoursEnabled: quietHours.enabled }),
    ...(quietHours?.start === undefined
      ? {}
      : { quietHoursStart: quietHours.start }),
    ...(quietHours?.end === undefined ? {} : { quietHoursEnd: quietHours.end }),
    ...(quietHours?.timeZone === undefined
      ? {}
      : { quietHoursTimeZone: quietHours.timeZone }),
    ...(quietHours?.minSeverity === undefined
      ? {}
      : { quietHoursMinSeverity: quietHours.minSeverity }),
    ...(digest?.enabled === undefined ? {} : { digestEnabled: digest.enabled }),
    ...(digest?.windowMinutes === undefined
      ? {}
      : { digestWindowMinutes: digest.windowMinutes }),
    ...(digest?.immediateFloor === undefined
      ? {}
      : { digestImmediateFloor: digest.immediateFloor }),
    ...(cap?.enabled === undefined ? {} : { alertCapEnabled: cap.enabled }),
    ...(cap?.maxPerHour === undefined
      ? {}
      : { alertCapPerHour: cap.maxPerHour }),
    ...(updateInPlace === undefined ? {} : { updateInPlace }),
    ...(maintenanceNotice?.enabled === undefined ? {} : { maintenanceNoticeEnabled: maintenanceNotice.enabled }),
    ...(maintenanceNotice?.leadMinutes === undefined
      ? {}
      : { maintenanceNoticeLeadMinutes: maintenanceNotice.leadMinutes }),
    ...(escalation?.enabled === undefined ? {} : { escalationEnabled: escalation.enabled }),
    ...(escalation?.afterMinutes === undefined ? {} : { escalationAfterMinutes: escalation.afterMinutes }),
    ...(escalation?.channel === undefined ? {} : { escalationChannel: escalation.channel }),
    ...(escalation?.minSeverity === undefined ? {} : { escalationMinSeverity: escalation.minSeverity }),
    ...(channelHealth?.enabled === undefined ? {} : { channelHealthEnabled: channelHealth.enabled }),
    ...(channelHealth?.afterFailures === undefined
      ? {}
      : { channelHealthAfterFailures: channelHealth.afterFailures }),
  };
}

/**
 * Runtime configuration, which in the UI edition replaces `config.yml` entirely.
 * Writes take effect on the next poll cycle because the scheduler re-reads the
 * config source every pass — nothing here restarts anything.
 *
 * Service writes validate against the same zod schema the Light edition's file
 * loader uses, so the two editions cannot disagree about what a valid provider is.
 *
 * Channel credentials are stored as environment variable *names*. A request
 * carrying a literal secret is refused outright rather than stored and masked:
 * the database is never given the chance to hold one.
 */
export function configRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();
  const db = runtime.db;

  router.get("/config", (_req, res) => {
    const settings = readSettings(db, runtime.logger);
    res.json({
      services: listServices(db),
      polling: {
        intervalMinutes: settings.pollIntervalMinutes,
        requestTimeoutSeconds: settings.requestTimeoutSeconds,
        maxRetries: settings.maxRetries,
        failureThreshold: settings.failureThreshold,
        adaptivePolling: settings.adaptivePolling,
        adaptiveIntervalMinutes: settings.adaptiveIntervalMinutes,
        confirmSamples: settings.confirmSamples,
        correlationThreshold: settings.correlationThreshold,
        correlationWindowMinutes: settings.correlationWindowMinutes,
      },
      retention: { days: settings.retentionDays },
      // Quiet hours, the digest window, the per-provider cap and whether an
      // incident's updates edit one message. Read through the same helper the
      // config source uses, so what the dashboard shows is what the dispatcher
      // is running on.
      delivery: deliveryOf(settings),
      // Roadmap 15.11a. `runtime.updateCheck.state()` is in-memory, refreshed
      // by the daily timer in `runtime.ts` — the setting itself lives here in
      // SQLite like every other one, so a toggle survives a restart even
      // though the last result does not.
      updateCheck: { enabled: settings.updateCheckEnabled, ...runtime.updateCheck.state() },
      catalogFeed: { enabled: settings.catalogFeedEnabled, ...runtime.catalogFeed.state() },
      channels: describeChannels(db, runtime.env),
      routing: describeRouting(db, runtime.logger),
      // Who each channel reaches, preferred first (roadmap 3.5).
      recipients: listRecipients(db, runtime.logger),
      // Removed but still restorable. Part of the config payload rather than a
      // route of its own: the undo has to be visible on a page an operator
      // reloads tomorrow, not only in the seconds a toast lives for.
      removed: listRemovedServices(db),
    });
  });

  /**
   * The bundled provider catalog (roadmap 5.11), with the ids already in use
   * marked rather than removed: a first run should read as a menu, and an
   * entry missing from that menu because it is already watched would look like
   * a catalog that forgot about it.
   *
   * No network on the request path: the list ships with the image, or — once
   * the operator opts into catalog updates (roadmap 2.2) — is the last signed
   * copy downloaded in the background. Detection stays the path for a page the
   * list does not have.
   */
  router.get("/config/catalog", (_req, res) => {
    const taken = new Set(listServices(db).map((service) => service.id));
    res.json({
      providers: runtime.catalogFeed.entries().map((entry) => ({
        ...entry,
        configured: taken.has(entry.id),
      })),
    });
  });

  /**
   * Configured providers whose catalog entry has moved since — roadmap 2.2.
   * Proposed, never applied: accepting one is an ordinary
   * `PATCH /config/services/:id` with the `to` it carries, so it goes through
   * every check an edit by hand does.
   */
  router.get("/config/catalog/proposals", (_req, res) => {
    res.json({ proposals: runtime.catalogFeed.proposals() });
  });

  configImportExportRoutes(runtime, router);

  /** Turns one proposal down, for this exact value: a later move asks again. */
  router.post("/config/catalog/proposals/:id/dismiss", (req, res) => {
    if (!runtime.catalogFeed.dismiss(req.params.id)) {
      res.status(404).json({ error: { message: `no catalog proposal for ${req.params.id}` } });
      return;
    }
    res.status(204).end();
  });

  router.post("/config/services", (req, res) => {
    const parsed = serviceDefinitionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    if (listServices(db).some((service) => service.id === parsed.data.id)) {
      res
        .status(409)
        .json({
          error: { message: `service ${parsed.data.id} already exists` },
        });
      return;
    }
    // Roadmap 11.1: an adapter whose options are a declared mapping checks them
    // here, while the operator is still looking at the form, rather than
    // letting a typo surface three minutes later as a failed poll.
    const problems = [
      ...optionProblems(parsed.data.adapter, parsed.data.options),
      ...cadenceProblems(parsed.data),
    ];
    if (problems.length > 0) {
      res.status(400).json({ error: { message: problems.join("; ") } });
      return;
    }
    insertService(db, parsed.data);
    res
      .status(201)
      .json(listServices(db).find((service) => service.id === parsed.data.id));
    // Fire-and-forget: the response must not wait on a provider's status page.
    // backfillOne never rejects; failures are logged inside the service.
    void runtime.backfill.backfillOne(parsed.data.id);
  });

  // Read-only reach upstream: it records nothing and notifies nothing, exactly
  // like the connection test — the picker just needs the list before a service
  // row exists.
  router.post("/config/services/preview-components", async (req, res) => {
    const parsed = previewComponentsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    let adapter;
    try {
      adapter = getAdapter(parsed.data.adapter);
    } catch {
      res
        .status(400)
        .json({
          error: { message: `unknown adapter: ${parsed.data.adapter}` },
        });
      return;
    }
    if (adapter.listComponents === undefined) {
      res.json({ supported: false, components: [] });
      return;
    }
    const { requestTimeoutSeconds } = readSettings(db, runtime.logger);
    try {
      const components = await adapter.listComponents(
        { id: "preview", name: "preview", baseUrl: parsed.data.baseUrl },
        { timeoutMs: requestTimeoutSeconds * 1000 },
      );
      res.json({ supported: true, components });
    } catch (error) {
      res
        .status(502)
        .json({
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
    }
  });

  /**
   * Which adapter reads the page at a given url, and the base url it wants
   * (roadmap 1.14). Read-only upstream like the preview above: it records
   * nothing and notifies nothing, and no service row exists yet.
   *
   * A page nothing recognised answers 200 with `adapter: null` and the probes
   * it tried, the same way the connection test reports a provider that would
   * not answer: the dashboard asked a question and got an answer, and the
   * operator can still pick an adapter by hand.
   */
  router.post("/config/services/detect", async (req, res) => {
    const parsed = detectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    const { requestTimeoutSeconds } = readSettings(db, runtime.logger);
    try {
      res.json(
        await detectAdapter(parsed.data.url, {
          timeoutMs: requestTimeoutSeconds * 1000,
        }),
      );
    } catch (error) {
      // Only an unusable url reaches here — every probe failure is an outcome,
      // not an exception — so this is the request's own fault.
      res
        .status(400)
        .json({
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
    }
  });

  router.patch("/config/services/:id", (req, res) => {
    const parsed = servicePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    const existing = listServices(db).find(
      (service) => service.id === req.params.id,
    );
    if (existing !== undefined && parsed.data.options !== undefined) {
      // Against the adapter the row will have once the patch lands, which is
      // not always the one it has now.
      const problems = optionProblems(
        parsed.data.adapter ?? existing.adapter,
        parsed.data.options,
      );
      if (problems.length > 0) {
        res.status(400).json({ error: { message: problems.join("; ") } });
        return;
      }
    }
    if (existing !== undefined) {
      // The cadence the row will have once the patch lands: naming one of the
      // two intervals clears the other (see `updateService`), and an adapter
      // change can turn a probe's seconds into a status page's.
      const { intervalMinutes, intervalSeconds } = parsed.data;
      const problems = cadenceProblems({
        adapter: parsed.data.adapter ?? existing.adapter,
        intervalMinutes:
          intervalMinutes !== undefined
            ? intervalMinutes
            : typeof intervalSeconds === "number"
              ? null
              : existing.intervalMinutes,
        intervalSeconds:
          intervalSeconds !== undefined
            ? intervalSeconds
            : typeof intervalMinutes === "number"
              ? null
              : existing.intervalSeconds,
      });
      if (problems.length > 0) {
        res.status(400).json({ error: { message: problems.join("; ") } });
        return;
      }
    }
    if (!updateService(db, req.params.id, parsed.data)) {
      res
        .status(404)
        .json({ error: { message: `unknown service: ${req.params.id}` } });
      return;
    }
    res.json(listServices(db).find((service) => service.id === req.params.id));
  });

  // Read before the destructive write it precedes: the confirmation names what
  // the cascade will take, so "remove" stops being a leap in the dark.
  router.get("/config/services/:id/impact", (req, res) => {
    const impact = describeServiceImpact(db, req.params.id);
    if (impact === null) {
      res
        .status(404)
        .json({ error: { message: `unknown service: ${req.params.id}` } });
      return;
    }
    res.json(impact);
  });

  /**
   * A removal is a soft delete: the provider leaves the dashboard and the poll
   * cycle at once, and its history waits out a grace period in which the whole
   * thing can be undone. The response says when that runs out, because the
   * dashboard's undo affordance is only honest if it knows.
   */
  router.delete("/config/services/:id", (req, res) => {
    const removedAt = new Date().toISOString();
    if (!softDeleteService(db, req.params.id, new Date(removedAt))) {
      res
        .status(404)
        .json({ error: { message: `unknown service: ${req.params.id}` } });
      return;
    }
    res.json({
      removed: req.params.id,
      removedAt,
      restoreUntil: restoreDeadline(removedAt),
    });
  });

  /** Undo, for as long as the grace period lasts: nothing was taken, so nothing is rebuilt. */
  router.post("/config/services/:id/restore", (req, res) => {
    if (!restoreService(db, req.params.id)) {
      res
        .status(404)
        .json({ error: { message: `no removed service: ${req.params.id}` } });
      return;
    }
    res.json(listServices(db).find((service) => service.id === req.params.id));
    // The provider was invisible while removed, so its history has a hole where
    // the grace period was. Same fire-and-forget backfill an add gets.
    void runtime.backfill.backfillOne(req.params.id);
  });

  /**
   * "Remove it now" — the destructive half, kept behind its own path rather
   * than a flag on the delete above, so nothing can reach it by accident. This
   * is the call that takes the samples, incidents, maintenances and rules
   * `GET /config/services/:id/impact` named.
   */
  router.delete("/config/services/:id/permanently", (req, res) => {
    if (!purgeService(db, req.params.id)) {
      res
        .status(404)
        .json({ error: { message: `unknown service: ${req.params.id}` } });
      return;
    }
    // The provider is gone, so are its diagnostics: probes for an id nothing
    // polls any more would sit in memory until the process ends.
    runtime.adapterDebug.forget(req.params.id);
    res.json({ purged: req.params.id });
  });

  router.patch("/config/settings", (req, res) => {
    const parsed = settingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    writeSettings(db, {
      ...(parsed.data.intervalMinutes === undefined
        ? {}
        : { pollIntervalMinutes: parsed.data.intervalMinutes }),
      ...(parsed.data.requestTimeoutSeconds === undefined
        ? {}
        : { requestTimeoutSeconds: parsed.data.requestTimeoutSeconds }),
      ...(parsed.data.maxRetries === undefined
        ? {}
        : { maxRetries: parsed.data.maxRetries }),
      ...(parsed.data.failureThreshold === undefined
        ? {}
        : { failureThreshold: parsed.data.failureThreshold }),
      ...(parsed.data.adaptivePolling === undefined
        ? {}
        : { adaptivePolling: parsed.data.adaptivePolling }),
      ...(parsed.data.adaptiveIntervalMinutes === undefined
        ? {}
        : { adaptiveIntervalMinutes: parsed.data.adaptiveIntervalMinutes }),
      ...(parsed.data.confirmSamples === undefined
        ? {}
        : { confirmSamples: parsed.data.confirmSamples }),
      ...(parsed.data.correlationThreshold === undefined
        ? {}
        : { correlationThreshold: parsed.data.correlationThreshold }),
      ...(parsed.data.correlationWindowMinutes === undefined
        ? {}
        : { correlationWindowMinutes: parsed.data.correlationWindowMinutes }),
      ...(parsed.data.retentionDays === undefined
        ? {}
        : { retentionDays: parsed.data.retentionDays }),
      ...(parsed.data.updateCheckEnabled === undefined
        ? {}
        : { updateCheckEnabled: parsed.data.updateCheckEnabled }),
      ...(parsed.data.catalogFeedEnabled === undefined
        ? {}
        : { catalogFeedEnabled: parsed.data.catalogFeedEnabled }),
      ...deliveryPatch(parsed.data.delivery),
    });
    // Turning catalog updates on asks straight away rather than at the next
    // daily tick: the operator who flips it wants to see it work. Not awaited —
    // the save answers now, the check lands in the background.
    if (parsed.data.catalogFeedEnabled === true) void runtime.catalogFeed.maybeRun(true, { force: true });
    const settings = readSettings(db, runtime.logger);
    res.json({
      delivery: deliveryOf(settings),
      updateCheck: { enabled: settings.updateCheckEnabled, ...runtime.updateCheck.state() },
      catalogFeed: { enabled: settings.catalogFeedEnabled, ...runtime.catalogFeed.state() },
      polling: {
        intervalMinutes: settings.pollIntervalMinutes,
        requestTimeoutSeconds: settings.requestTimeoutSeconds,
        maxRetries: settings.maxRetries,
        failureThreshold: settings.failureThreshold,
        adaptivePolling: settings.adaptivePolling,
        adaptiveIntervalMinutes: settings.adaptiveIntervalMinutes,
        confirmSamples: settings.confirmSamples,
        correlationThreshold: settings.correlationThreshold,
        correlationWindowMinutes: settings.correlationWindowMinutes,
      },
      retention: { days: settings.retentionDays },
    });
  });

  configStorageRoutes(runtime, router);

  configBackupRoutes(runtime, router);

  configChannelRoutes(runtime, router);

  // The only route that reaches a provider on demand. It records nothing: a
  // connection test is diagnostics, not history and not an alert.
  router.post("/config/services/:id/test", async (req, res) => {
    const service = listServices(db).find(
      (entry) => entry.id === req.params.id,
    );
    if (service === undefined) {
      res
        .status(404)
        .json({ error: { message: `unknown service: ${req.params.id}` } });
      return;
    }
    const { requestTimeoutSeconds } = readSettings(db, runtime.logger);
    try {
      const status = await getAdapter(service.adapter).fetchStatus(
        {
          id: service.id,
          name: service.name,
          baseUrl: service.baseUrl,
          options: service.options,
          components: service.components,
          scopeToComponents: service.scopeToComponents,
        },
        { timeoutMs: requestTimeoutSeconds * 1000 },
      );
      res.json({ ok: true, overallStatus: status.overallStatus });
    } catch (error) {
      res.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  configPushRoutes(runtime, router);

  return router;
}
