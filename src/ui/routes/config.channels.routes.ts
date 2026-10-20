import { z } from "zod";
import type { Router } from "express";
import {
  localeSchema,
  recipientsSchema,
  routingRulesSchema,
} from "../../core/config.schema.ts";
import {
  describeChannels,
  describeRouting,
  listChannels,
  listRecipients,
  listServices,
  replaceRecipients,
  replaceRoutingRules,
  updateChannel,
} from "../dbConfigSource.ts";
import { TEMPLATE_MAX_LENGTH } from "../../notifiers/template.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { issues } from "./config.shared.ts";

const channelPatchSchema = z.object({
  enabled: z.boolean().optional(),
  fields: z.record(z.string()).optional(),
  /**
   * The language this channel's messages are written in (roadmap 3.20), or an
   * empty string to go back to the installation's own. Empty rather than `null`
   * because this is what a cleared `<select>` sends, and a second spelling of
   * "unset" is a second thing to get wrong.
   */
  locale: z.union([localeSchema, z.literal("")]).optional(),
  /**
   * This channel's message template (roadmap 3.15); empty clears it. Length is
   * checked here and the token set in `updateChannel`, which is where the Light
   * edition's loader checks it too.
   */
  template: z.string().max(TEMPLATE_MAX_LENGTH).optional(),
});
// Credential *values*, unlike the patch above's variable names. At least one,
// because an empty save is a request that would report success having done
// nothing; the value rules themselves live in the secrets file.
const channelSecretsSchema = z.object({
  fields: z
    .record(z.string())
    .refine((fields) => Object.keys(fields).length > 0, {
      message: "at least one field is required",
    }),
});

export function configChannelRoutes(runtime: UiRuntimeCore, router: Router): void {
  const db = runtime.db;

  router.patch("/config/channels/:id", (req, res) => {
    const parsed = channelPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    if (!listChannels(db).some((channel) => channel.id === req.params.id)) {
      res
        .status(404)
        .json({ error: { message: `unknown channel: ${req.params.id}` } });
      return;
    }
    try {
      updateChannel(db, req.params.id, parsed.data);
    } catch (error) {
      res
        .status(400)
        .json({
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      return;
    }
    res.json(
      describeChannels(db, runtime.env).find(
        (channel) => channel.id === req.params.id,
      ),
    );
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
    const stored = listChannels(db).find(
      (channel) => channel.id === req.params.id,
    );
    if (stored === undefined) {
      res
        .status(404)
        .json({ error: { message: `unknown channel: ${req.params.id}` } });
      return;
    }

    // Every field is resolved to its variable before anything is written, so a
    // two-field channel cannot end up with one credential saved and one refused.
    const values: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed.data.fields)) {
      const envVar = stored.config[`${name}Env`];
      if (envVar === undefined) {
        res
          .status(400)
          .json({
            error: {
              message: `channel ${req.params.id} has no field "${name}"`,
            },
          });
        return;
      }
      values[envVar] = value;
    }

    try {
      await runtime.secrets.set(values);
    } catch (error) {
      res
        .status(400)
        .json({
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      return;
    }
    res.json(
      describeChannels(db, runtime.env).find(
        (channel) => channel.id === req.params.id,
      ),
    );
  });

  /**
   * Forgets a saved value. Only what the secrets file itself holds can be
   * removed: a variable the container supplied is not this dashboard's to
   * delete, and reporting that plainly beats a success that changes nothing.
   */
  router.delete("/config/channels/:id/secrets/:field", async (req, res) => {
    const stored = listChannels(db).find(
      (channel) => channel.id === req.params.id,
    );
    if (stored === undefined) {
      res
        .status(404)
        .json({ error: { message: `unknown channel: ${req.params.id}` } });
      return;
    }
    const envVar = stored.config[`${req.params.field}Env`];
    if (envVar === undefined) {
      res
        .status(400)
        .json({
          error: {
            message: `channel ${req.params.id} has no field "${req.params.field}"`,
          },
        });
      return;
    }
    if (!(await runtime.secrets.clear(envVar))) {
      res.status(409).json({
        error: {
          message: `${envVar} was not saved here — it comes from the container's environment`,
        },
      });
      return;
    }
    res.json(
      describeChannels(db, runtime.env).find(
        (channel) => channel.id === req.params.id,
      ),
    );
  });

  router.post("/config/channels/:id/test", async (req, res) => {
    const stored = listChannels(db).find(
      (channel) => channel.id === req.params.id,
    );
    if (stored === undefined) {
      res
        .status(404)
        .json({ error: { message: `unknown channel: ${req.params.id}` } });
      return;
    }

    const config = await runtime.configSource.load();
    const resolved = config.channels.find(
      (channel) => channel.id === req.params.id,
    );
    const missing =
      describeChannels(db, runtime.env)
        .find((channel) => channel.id === req.params.id)
        // Optional credentials are skipped: an unset signing secret means
        // "send unsigned", not "this channel cannot be tested".
        ?.fields.filter((field) => !field.isSet && !field.optional)
        .map((field) => field.envVar) ?? [];

    if (missing.length > 0 || resolved === undefined) {
      res.json({
        ok: false,
        error: `not configured: ${missing.join(", ")} is not set in the environment`,
      });
      return;
    }

    const [notifier] = runtime.buildNotifiers([{ ...resolved, enabled: true }]);
    if (notifier === undefined) {
      res.json({
        ok: false,
        error: `channel ${req.params.id} could not be built`,
      });
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
    // The channel's own wording, so the test shows what the channel will
    // actually send rather than a message in the fleet's default language
    // (roadmap 3.20) and the default layout (roadmap 3.15).
    const record = await runtime.dispatcher.sendTest(
      notifier,
      service,
      config.locale,
      {
        ...(resolved.locale === undefined ? {} : { locale: resolved.locale }),
        ...(resolved.template === undefined
          ? {}
          : { template: resolved.template }),
      },
    );
    res.json(record.ok ? { ok: true } : { ok: false, error: record.error });
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
          error: {
            message: `rule ${index + 1} targets the channel "${channel}", which does not exist`,
          },
        });
        return;
      }
    }

    try {
      replaceRoutingRules(db, parsed.data.rules);
    } catch (error) {
      res
        .status(400)
        .json({
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      return;
    }
    res.json(describeRouting(db, runtime.logger));
  });

  /**
   * Every recipient at once (roadmap 3.5), like the routing rules: the dashboard
   * holds the whole list, and a whole-list write cannot interleave with itself.
   * Applies from the next dispatch, because the config source re-reads it.
   */
  router.put("/config/recipients", (req, res) => {
    const parsed = z.object({ recipients: recipientsSchema }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    try {
      replaceRecipients(db, parsed.data.recipients);
    } catch (error) {
      res.status(400).json({ error: { message: error instanceof Error ? error.message : String(error) } });
      return;
    }
    res.json({ recipients: listRecipients(db, runtime.logger) });
  });
}
