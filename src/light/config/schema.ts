import { z } from "zod";
import { localeSchema, routingRuleSchema, serviceDefinitionSchema } from "../../core/config.schema.ts";

/**
 * The shape of `config.yml`. Service definitions and the locale reuse the shared
 * core schemas rather than restating them, so the Light edition's file and the
 * UI edition's settings writes can never validate the same entity differently.
 */

const positiveInt = z.number().int().positive();

const telegramSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().default(""),
  chatId: z.string().default(""),
});

const webhookSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default(""),
  /**
   * Optional shared secret for the `X-IsItDown-Signature` header. Written as a
   * `${VAR}` reference like every other credential — a secret in the file is a
   * secret in the operator's git history.
   */
  secret: z.string().default(""),
});

const discordSchema = z.object({
  enabled: z.boolean().default(false),
  webhookUrl: z.string().default(""),
});

const slackSchema = z.object({
  enabled: z.boolean().default(false),
  webhookUrl: z.string().default(""),
});

/** Required non-empty settings per channel, used to produce an actionable error. */
export const REQUIRED_CHANNEL_SETTINGS: Record<string, readonly string[]> = {
  telegram: ["botToken", "chatId"],
  webhook: ["url"],
  discord: ["webhookUrl"],
  slack: ["webhookUrl"],
};

export const fileConfigSchema = z.object({
  pollIntervalMinutes: positiveInt.max(1440).optional(),
  requestTimeoutSeconds: positiveInt.max(120).optional(),
  maxRetries: positiveInt.max(10).optional(),
  failureThreshold: positiveInt.max(100).optional(),
  /**
   * Poll a provider with an open incident on `adaptiveIntervalMinutes` instead
   * of its own cadence. Omitted, not defaulted: the shared polling schema owns
   * the default, and restating it here is how the two editions drift.
   */
  adaptivePolling: z.boolean().optional(),
  adaptiveIntervalMinutes: positiveInt.max(1440).optional(),
  /** Consecutive agreeing polls before a transition notifies. 1 is off. */
  confirmSamples: positiveInt.max(10).optional(),
  locale: localeSchema.optional(),
  services: z.array(serviceDefinitionSchema).min(1, "at least one service is required"),
  notifications: z
    .object({
      telegram: telegramSchema.optional(),
      webhook: webhookSchema.optional(),
      discord: discordSchema.optional(),
      slack: slackSchema.optional(),
    })
    .strict()
    .default({}),
  /**
   * Evaluation order is the file's order — first matching rule decides.
   * Absent means "everything to every enabled channel", the edition's
   * behaviour before routing existed, and still the default with the key
   * left out.
   */
  routing: z.array(routingRuleSchema).optional(),
});

export type FileConfig = z.infer<typeof fileConfigSchema>;
