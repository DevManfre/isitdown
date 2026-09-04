import { Router } from "express";
import { z } from "zod";
import { getAdapter } from "../../adapters/index.ts";
import { pollingSchema, routingRulesSchema, serviceDefinitionSchema } from "../../core/config.schema.ts";
import {
  deleteService,
  describeChannels,
  describeRouting,
  describeServiceImpact,
  insertService,
  listChannels,
  listServices,
  readSettings,
  replaceRoutingRules,
  updateChannel,
  updateService,
  writeSettings,
} from "../dbConfigSource.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { ensureVapidKeys } from "../vapidKeys.ts";

const servicePatchSchema = serviceDefinitionSchema.partial().omit({ id: true });
const previewComponentsSchema = serviceDefinitionSchema.pick({ adapter: true, baseUrl: true });
const settingsPatchSchema = pollingSchema.partial();
const channelPatchSchema = z.object({
  enabled: z.boolean().optional(),
  fields: z.record(z.string()).optional(),
});
// Credential *values*, unlike the patch above's variable names. At least one,
// because an empty save is a request that would report success having done
// nothing; the value rules themselves live in the secrets file.
const channelSecretsSchema = z.object({
  fields: z.record(z.string()).refine((fields) => Object.keys(fields).length > 0, {
    message: "at least one field is required",
  }),
});
// Push endpoints are https by protocol (no browser issues a plain-http one),
// and none of these fields has any business being large — a browser-supplied
// body should not be able to push arbitrary-length strings into SQLite.
const subscriptionSchema = z.object({
  endpoint: z.string().max(2048).url().startsWith("https://"),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
  label: z.string().min(1).max(80),
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
      routing: describeRouting(db, runtime.logger),
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
      res.status(400).json({ error: { message: `unknown adapter: ${parsed.data.adapter}` } });
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
      res.status(502).json({ error: { message: error instanceof Error ? error.message : String(error) } });
    }
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

  // Read before the destructive write it precedes: the confirmation names what
  // the cascade will take, so "remove" stops being a leap in the dark.
  router.get("/config/services/:id/impact", (req, res) => {
    const impact = describeServiceImpact(db, req.params.id);
    if (impact === null) {
      res.status(404).json({ error: { message: `unknown service: ${req.params.id}` } });
      return;
    }
    res.json(impact);
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

  /**
   * The value behind a channel's environment variable, saved from the dashboard
   * so the operator does not have to recreate the container to set one.
   *
   * Write-only by construction: it lands in the secrets file beside the database
   * and in the process environment (see src/ui/secretsFile.ts), never in the
   * `channels` row, and no route hands a value back — `describeChannels` still
   * reports nothing but the variable's name and whether it resolves.
   *
   * Which variable a value is written to is the channel's own `*Env` reference,
   * never something the request names: a request that could choose the variable
   * could point one at another channel's credential, which is the same
   * disclosure path `updateChannel`'s collision check exists to close.
   */
  router.put("/config/channels/:id/secrets", async (req, res) => {
    const parsed = channelSecretsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    const stored = listChannels(db).find((channel) => channel.id === req.params.id);
    if (stored === undefined) {
      res.status(404).json({ error: { message: `unknown channel: ${req.params.id}` } });
      return;
    }

    // Every field is resolved to its variable before anything is written, so a
    // two-field channel cannot end up with one credential saved and one refused.
    const values: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed.data.fields)) {
      const envVar = stored.config[`${name}Env`];
      if (envVar === undefined) {
        res.status(400).json({ error: { message: `channel ${req.params.id} has no field "${name}"` } });
        return;
      }
      values[envVar] = value;
    }

    try {
      await runtime.secrets.set(values);
    } catch (error) {
      res.status(400).json({ error: { message: error instanceof Error ? error.message : String(error) } });
      return;
    }
    res.json(describeChannels(db, runtime.env).find((channel) => channel.id === req.params.id));
  });

  /**
   * Forgets a saved value. Only what the secrets file itself holds can be
   * removed: a variable the container supplied is not this dashboard's to
   * delete, and reporting that plainly beats a success that changes nothing.
   */
  router.delete("/config/channels/:id/secrets/:field", async (req, res) => {
    const stored = listChannels(db).find((channel) => channel.id === req.params.id);
    if (stored === undefined) {
      res.status(404).json({ error: { message: `unknown channel: ${req.params.id}` } });
      return;
    }
    const envVar = stored.config[`${req.params.field}Env`];
    if (envVar === undefined) {
      res.status(400).json({ error: { message: `channel ${req.params.id} has no field "${req.params.field}"` } });
      return;
    }
    if (!(await runtime.secrets.clear(envVar))) {
      res.status(409).json({
        error: { message: `${envVar} was not saved here — it comes from the container's environment` },
      });
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
      res.json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  /**
   * The whole ordered list in one write. Per-row updates would make reordering
   * a sequence of position rewrites that can interleave, and the dashboard
   * holds the full list already.
   *
   * A rule naming a channel no registry knows is refused here rather than
   * warned about at dispatch time: at write time there is somebody to tell.
   */
  router.put("/config/routing", (req, res) => {
    const parsed = z.object({ rules: routingRulesSchema }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }

    const known = new Set(listChannels(db).map((channel) => channel.id));
    for (const [index, rule] of parsed.data.rules.entries()) {
      for (const channel of rule.channels) {
        if (channel === "*" || known.has(channel)) continue;
        res.status(400).json({
          error: { message: `rule ${index + 1} targets the channel "${channel}", which does not exist` },
        });
        return;
      }
    }

    try {
      replaceRoutingRules(db, parsed.data.rules);
    } catch (error) {
      res.status(400).json({ error: { message: error instanceof Error ? error.message : String(error) } });
      return;
    }
    res.json(describeRouting(db, runtime.logger));
  });

  /**
   * The VAPID public key is public by construction — the browser needs it to
   * subscribe. Its private half is generated alongside it and stays in the
   * process; neither is an operator credential, so nothing here reads the
   * environment and the channel has no fields to configure (see
   * src/ui/vapidKeys.ts).
   */
  router.get("/config/push", (_req, res) => {
    res.json({ publicKey: ensureVapidKeys(db, runtime.logger).publicKey });
  });

  router.get("/config/push/subscriptions", (_req, res) => {
    res.json({ devices: runtime.pushSubscriptions.listDevices() });
  });

  router.post("/config/push/subscriptions", (req, res) => {
    const parsed = subscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    const { endpoint, keys, label } = parsed.data;
    runtime.pushSubscriptions.save({ endpoint, keys }, label);
    res.status(201).json({ devices: runtime.pushSubscriptions.listDevices() });
  });

  router.delete("/config/push/subscriptions/:id", (req, res) => {
    if (!runtime.pushSubscriptions.remove(req.params.id)) {
      res.status(404).json({ error: { message: `unknown device: ${req.params.id}` } });
      return;
    }
    res.status(204).end();
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

    const [notifier] = runtime.buildNotifiers([{ ...resolved, enabled: true }]);
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
      components: [],
      scopeToComponents: false,
    };
    const record = await runtime.dispatcher.sendTest(notifier, service, config.locale);
    res.json(record.ok ? { ok: true } : { ok: false, error: record.error });
  });

  return router;
}
