import { Router } from "express";
import { z } from "zod";
import { getAdapter } from "../../adapters/index.ts";
import { pollingSchema, serviceDefinitionSchema } from "../../core/config.schema.ts";
import { buildNotifiers } from "../../notifiers/index.ts";
import {
  deleteService,
  describeChannels,
  insertService,
  listChannels,
  listServices,
  readSettings,
  updateChannel,
  updateService,
  writeSettings,
} from "../dbConfigSource.ts";
import type { UiRuntimeCore } from "../runtime.ts";

const servicePatchSchema = serviceDefinitionSchema.partial().omit({ id: true });
const settingsPatchSchema = pollingSchema.partial();
const channelPatchSchema = z.object({
  enabled: z.boolean().optional(),
  fields: z.record(z.string()).optional(),
});

const issues = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");

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
      },
      channels: describeChannels(db, runtime.env),
    });
  });

  router.post("/config/services", (req, res) => {
    const parsed = serviceDefinitionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    if (listServices(db).some((service) => service.id === parsed.data.id)) {
      res.status(409).json({ error: { message: `service ${parsed.data.id} already exists` } });
      return;
    }
    insertService(db, parsed.data);
    res.status(201).json(listServices(db).find((service) => service.id === parsed.data.id));
  });

  router.patch("/config/services/:id", (req, res) => {
    const parsed = servicePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    if (!updateService(db, req.params.id, parsed.data)) {
      res.status(404).json({ error: { message: `unknown service: ${req.params.id}` } });
      return;
    }
    res.json(listServices(db).find((service) => service.id === req.params.id));
  });

  router.delete("/config/services/:id", (req, res) => {
    if (!deleteService(db, req.params.id)) {
      res.status(404).json({ error: { message: `unknown service: ${req.params.id}` } });
      return;
    }
    res.json({ deleted: req.params.id });
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
      ...(parsed.data.maxRetries === undefined ? {} : { maxRetries: parsed.data.maxRetries }),
      ...(parsed.data.failureThreshold === undefined
        ? {}
        : { failureThreshold: parsed.data.failureThreshold }),
    });
    const settings = readSettings(db, runtime.logger);
    res.json({
      polling: {
        intervalMinutes: settings.pollIntervalMinutes,
        requestTimeoutSeconds: settings.requestTimeoutSeconds,
        maxRetries: settings.maxRetries,
        failureThreshold: settings.failureThreshold,
      },
    });
  });

  router.patch("/config/channels/:id", (req, res) => {
    const parsed = channelPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    if (!listChannels(db).some((channel) => channel.id === req.params.id)) {
      res.status(404).json({ error: { message: `unknown channel: ${req.params.id}` } });
      return;
    }
    try {
      updateChannel(db, req.params.id, parsed.data);
    } catch (error) {
      res.status(400).json({ error: { message: error instanceof Error ? error.message : String(error) } });
      return;
    }
    res.json(describeChannels(db, runtime.env).find((channel) => channel.id === req.params.id));
  });

  // The only route that reaches a provider on demand. It records nothing: a
  // connection test is diagnostics, not history and not an alert.
  router.post("/config/services/:id/test", async (req, res) => {
    const service = listServices(db).find((entry) => entry.id === req.params.id);
    if (service === undefined) {
      res.status(404).json({ error: { message: `unknown service: ${req.params.id}` } });
      return;
    }
    const { requestTimeoutSeconds } = readSettings(db, runtime.logger);
    try {
      const status = await getAdapter(service.adapter).fetchStatus(
        { id: service.id, name: service.name, baseUrl: service.baseUrl, options: service.options },
        { timeoutMs: requestTimeoutSeconds * 1000 },
      );
      res.json({ ok: true, overallStatus: status.overallStatus });
    } catch (error) {
      res.json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/config/channels/:id/test", async (req, res) => {
    const stored = listChannels(db).find((channel) => channel.id === req.params.id);
    if (stored === undefined) {
      res.status(404).json({ error: { message: `unknown channel: ${req.params.id}` } });
      return;
    }

    const config = await runtime.configSource.load();
    const resolved = config.channels.find((channel) => channel.id === req.params.id);
    const missing = describeChannels(db, runtime.env)
      .find((channel) => channel.id === req.params.id)
      ?.fields.filter((field) => !field.isSet)
      .map((field) => field.envVar) ?? [];

    if (missing.length > 0 || resolved === undefined) {
      res.json({ ok: false, error: `not configured: ${missing.join(", ")} is not set in the environment` });
      return;
    }

    const [notifier] = buildNotifiers([{ ...resolved, enabled: true }]);
    if (notifier === undefined) {
      res.json({ ok: false, error: `channel ${req.params.id} could not be built` });
      return;
    }

    const service = listServices(db)[0] ?? {
      id: "isitdown",
      name: "IsItDown",
      adapter: "statuspage",
      baseUrl: "https://example.com",
      enabled: true,
    };
    const record = await runtime.dispatcher.sendTest(notifier, service, config.locale);
    res.json(record.ok ? { ok: true } : { ok: false, error: record.error });
  });

  return router;
}
