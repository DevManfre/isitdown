import { Router } from "express";
import { z } from "zod";
import { getAdapter } from "../../adapters/index.ts";
import { pollingSchema, serviceDefinitionSchema } from "../../core/config.schema.ts";
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
const previewComponentsSchema = serviceDefinitionSchema.pick({ adapter: true, baseUrl: true });
const settingsPatchSchema = pollingSchema.partial();
const channelPatchSchema = z.object({
  enabled: z.boolean().optional(),
  fields: z.record(z.string()).optional(),
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

// A VAPID public key is an uncompressed P-256 point: base64url-decode it and
// it must be exactly 65 bytes starting with 0x04. This is the last line of
// defense in GET /config/push below: even if a stored *Env name were somehow
// pointed at the wrong variable, only a value that actually decodes to a
// public key of this shape is ever handed back. A regex over the encoded
// text (length + character set) was tried here before and was not enough —
// any long base64url-looking secret in an unreferenced variable passed a
// pattern match; decoding and checking the real structure is what closes
// that gap, so anything that fails to decode this way reads as unset.
function isVapidPublicKey(value: string): boolean {
  if (value === "") return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 65 && bytes[0] === 0x04;
}

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
   * The VAPID public key is public by construction — the browser needs it to
   * subscribe. Only the name of the private key's variable is ever stored, and
   * its value never leaves the process.
   *
   * `updateChannel` refuses a patch that aliases two `*Env` fields — of this
   * channel or any other — onto one variable name, but a row can still reach
   * a bad state from before that guard existed or from a direct DB edit, so
   * this route defends itself twice over rather than trusting the database:
   * first by name (do `publicKeyEnv` and `privateKeyEnv` agree?), then by the
   * shape of the value itself, below.
   */
  router.get("/config/push", (_req, res) => {
    const channel = listChannels(db).find((entry) => entry.id === "webpush");
    const publicKeyName = channel?.config["publicKeyEnv"] ?? "";
    const privateKeyName = channel?.config["privateKeyEnv"] ?? "";
    if (publicKeyName !== "" && publicKeyName === privateKeyName) {
      res.json({ publicKey: "" });
      return;
    }
    const value = runtime.env[publicKeyName] ?? "";
    // Belt and braces: whatever variable the stored name resolves to, only
    // hand it back once it decodes to an actual VAPID public key (see
    // isVapidPublicKey above). This is the last line that stops the server
    // echoing an arbitrary environment variable to a browser if a name ever
    // points somewhere it shouldn't — including one holding some other long
    // secret that merely looks base64url-shaped.
    res.json({ publicKey: isVapidPublicKey(value) ? value : "" });
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
