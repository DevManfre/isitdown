import { Router } from "express";
import { z } from "zod";

import { getAdapter } from "../../adapters/index.ts";
import { AI_KEY_ENV, AI_PROVIDERS, CLAUDE_TOKEN_ENV, type AiSettings } from "../aiSettings.ts";
import { readSettings, writeSettings } from "../dbConfigSource.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { issues } from "./config.shared.ts";

/**
 * Settings → AI implementation and the incident summary it powers — roadmap 6.10.
 *
 * The key is write-only like every channel credential: it lands in the secrets
 * file beside the database and in the process environment, never in SQLite,
 * and no route hands it back — `GET` says only whether one is set and where it
 * came from.
 */

const aiPatchSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS).optional(),
    model: z.string().trim().max(200).optional(),
    // Blank clears it back to OpenAI's own endpoint.
    baseUrl: z.union([z.literal(""), z.string().trim().url().max(2048)]).optional(),
  })
  .strict();

const keySchema = z.object({ value: z.string().min(1).max(4096) }).strict();

const summaryRequestSchema = z.object({ locale: z.string().trim().min(2).max(35).optional() }).strict();

export function aiSettingsOf(runtime: UiRuntimeCore): AiSettings {
  const settings = readSettings(runtime.db, runtime.logger);
  return { provider: settings.aiProvider, model: settings.aiModel, baseUrl: settings.aiBaseUrl };
}

async function describe(runtime: UiRuntimeCore) {
  const { claudeCliAvailable, DEFAULT_MODELS } = await import("../incidentSummary.ts");
  const credential = (envVar: string) => {
    const value = runtime.env[envVar];
    // Only what the dashboard saved can be cleared from the dashboard.
    return { envVar, set: value !== undefined && value !== "", saved: runtime.secrets.owns(envVar) };
  };
  return {
    ...aiSettingsOf(runtime),
    defaults: DEFAULT_MODELS,
    key: credential(AI_KEY_ENV),
    cliToken: credential(CLAUDE_TOKEN_ENV),
    claudeCli: claudeCliAvailable(runtime.env),
  };
}

export function aiRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  router.get("/config/ai", async (_req, res) => {
    res.json(await describe(runtime));
  });

  /**
   * What the model menu offers for the provider now chosen. Its own path, not
   * part of `GET /config/ai`: it may ask the provider, and the section must
   * paint without waiting on somebody else's server.
   */
  router.get("/config/ai/models", async (_req, res) => {
    const { listModels } = await import("../incidentSummary.ts");
    res.json(await listModels(aiSettingsOf(runtime), { env: runtime.env, ...runtime.summaryDeps }));
  });

  router.patch("/config/ai", async (req, res) => {
    const parsed = aiPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    const { provider, model, baseUrl } = parsed.data;
    writeSettings(runtime.db, {
      ...(provider === undefined ? {} : { aiProvider: provider }),
      ...(model === undefined ? {} : { aiModel: model }),
      ...(baseUrl === undefined ? {} : { aiBaseUrl: baseUrl }),
    });
    res.json(await describe(runtime));
  });

  /**
   * Two write-only credentials behind one pair of routes: `key` is the API key
   * (Anthropic or OpenAI-compatible), `cli-token` the Claude Code token. Which
   * variable a value lands in is fixed here, never named by the request.
   */
  const CREDENTIALS: Record<string, string> = { key: AI_KEY_ENV, "cli-token": CLAUDE_TOKEN_ENV };

  router.put("/config/ai/:credential", async (req, res, next) => {
    const envVar = CREDENTIALS[req.params.credential];
    if (envVar === undefined) return next();
    const parsed = keySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    try {
      await runtime.secrets.set({ [envVar]: parsed.data.value });
    } catch (error) {
      res.status(400).json({ error: { message: error instanceof Error ? error.message : String(error) } });
      return;
    }
    res.json(await describe(runtime));
  });

  router.delete("/config/ai/:credential", async (req, res, next) => {
    const envVar = CREDENTIALS[req.params.credential];
    if (envVar === undefined) return next();
    if (!(await runtime.secrets.clear(envVar))) {
      res.status(409).json({ error: { message: `${envVar} was not saved here — it comes from the container's environment` } });
      return;
    }
    res.json(await describe(runtime));
  });

  /**
   * One summary, written on request and not stored: the provider may post
   * another update a minute later, and a cached summary would then be the one
   * sentence on the page that is quietly wrong. A `POST` because it spends the
   * operator's tokens.
   */
  router.post("/incidents/:providerId/:incidentId/summary", async (req, res) => {
    const parsed = summaryRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    const settings = aiSettingsOf(runtime);
    if (settings.provider === "off") {
      res.status(409).json({ error: { message: "AI summaries are turned off — choose a provider in Settings → AI implementation", code: "not-configured" } });
      return;
    }
    const { providerId, incidentId } = req.params;
    const incident = await runtime.store.getIncident(providerId, incidentId);
    if (incident === null) {
      res.status(404).json({ error: { message: `unknown incident: ${providerId}/${incidentId}` } });
      return;
    }
    const service = runtime.listAllServices().find((entry) => entry.id === providerId);
    const adapter = service === undefined ? undefined : (runtime.getAdapter ?? getAdapter)(service.adapter);

    const { summarizeIncident, SummaryError } = await import("../incidentSummary.ts");
    let updates: Awaited<ReturnType<NonNullable<NonNullable<typeof adapter>["fetchIncidentUpdates"]>>> = [];
    if (service !== undefined && adapter?.fetchIncidentUpdates !== undefined) {
      try {
        updates = await adapter.fetchIncidentUpdates(
          { id: service.id, name: service.name, baseUrl: service.baseUrl, options: service.options },
          incidentId,
          { timeoutMs: readSettings(runtime.db, runtime.logger).requestTimeoutSeconds * 1000 },
        );
      } catch (error) {
        res.status(502).json({ error: { message: `could not read the provider's updates: ${error instanceof Error ? error.message : String(error)}`, code: "updates" } });
        return;
      }
    }
    if (updates.length === 0) {
      res.status(422).json({ error: { message: "the provider posted no updates to summarize", code: "no-updates" } });
      return;
    }

    try {
      const result = await summarizeIncident(
        settings,
        {
          providerName: service?.name ?? providerId,
          incidentName: incident.name,
          impact: incident.impact,
          status: incident.status,
          updates,
          locale: parsed.data.locale ?? "en",
        },
        { env: runtime.env, ...runtime.summaryDeps },
      );
      res.json({ ...result, updates: updates.length, generatedAt: new Date().toISOString() });
    } catch (error) {
      if (error instanceof SummaryError) {
        runtime.logger.warn("incident summary failed", { providerId, incidentId, code: error.code, error: error.message });
        res.status(error.code === "failed" ? 502 : 409).json({ error: { message: error.message, code: error.code } });
        return;
      }
      throw error;
    }
  });

  return router;
}
