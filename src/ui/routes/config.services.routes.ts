import { z } from "zod";
import type { Router } from "express";
import { detectAdapter } from "../../adapters/detect.ts";
import { cadenceProblems, getAdapter, optionProblems } from "../../adapters/index.ts";
import { serviceDefinitionSchema } from "../../core/config.schema.ts";
import {
  describeServiceImpact,
  insertService,
  listServices,
  purgeService,
  readSettings,
  restoreDeadline,
  restoreService,
  servicePatchSchema,
  softDeleteService,
  updateService,
} from "../dbConfigSource.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { issues } from "./config.shared.ts";

const previewComponentsSchema = serviceDefinitionSchema.pick({
  adapter: true,
  baseUrl: true,
});

/** Whatever the operator pasted into the base url field, before it is a service. */
const detectSchema = z.object({ url: z.string().min(1).max(2048) });

export function configServiceRoutes(runtime: UiRuntimeCore, router: Router): void {
  const db = runtime.db;

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
}
