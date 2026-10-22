import { Router } from "express";
import { z } from "zod";
import {
  alertCapSchema,
  maintenanceNoticeSchema,
  escalationSchema,
  channelHealthSchema,
  coalesceSchema,
  incidentSummarySchema,
  knownOutageSchema,
  reportSchema,
  digestSchema,
  pollingSchema,
  quietHoursSchema,
} from "../../core/config.schema.ts";
import {
  deliveryOf,
  describeChannels,
  describeRouting,
  listRecipients,
  listRemovedServices,
  listServices,
  readSettings,
  writeSettings,
} from "../dbConfigSource.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { configImportExportRoutes } from "./config.importexport.routes.ts";
import { configPushRoutes } from "./config.push.routes.ts";
import { configStorageRoutes } from "./config.storage.routes.ts";
import { configChannelRoutes } from "./config.channels.routes.ts";
import { configServiceRoutes } from "./config.services.routes.ts";
import { configBackupRoutes } from "./config.backup.routes.ts";
import { issues } from "./config.shared.ts";

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
  incidentSummary: incidentSummarySchema.partial().optional(),
  coalesce: coalesceSchema.partial().optional(),
  knownOutage: knownOutageSchema.partial().optional(),
  report: reportSchema.partial().optional(),
  attachChart: z.boolean().optional(),
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
  const { quietHours, digest, cap, updateInPlace, maintenanceNotice, escalation, channelHealth, incidentSummary, coalesce, knownOutage, report, attachChart } = patch;
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
    ...(incidentSummary?.enabled === undefined ? {} : { incidentSummaryEnabled: incidentSummary.enabled }),
    ...(coalesce?.enabled === undefined ? {} : { coalesceEnabled: coalesce.enabled }),
    ...(coalesce?.windowMinutes === undefined ? {} : { coalesceWindowMinutes: coalesce.windowMinutes }),
    ...(knownOutage?.enabled === undefined ? {} : { knownOutageEnabled: knownOutage.enabled }),
    ...(attachChart === undefined ? {} : { attachChart }),
    ...(report?.enabled === undefined ? {} : { reportEnabled: report.enabled }),
    ...(report?.frequency === undefined ? {} : { reportFrequency: report.frequency }),
    ...(report?.channel === undefined ? {} : { reportChannel: report.channel }),
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

  configServiceRoutes(runtime, router);

  configImportExportRoutes(runtime, router);

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

  configPushRoutes(runtime, router);

  return router;
}
