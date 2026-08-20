import { z } from "zod";

/**
 * Validation for the parts of the configuration both editions share. The Light
 * edition's file loader and the UI edition's settings writes compose these
 * rather than restating them, so the same entity can never end up with two
 * divergent definitions.
 */

const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "must be a lowercase slug: letters, digits and dashes");

const httpUrl = z
  .string()
  .trim()
  .refine(
    (value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return false;
      }
      return url.protocol === "http:" || url.protocol === "https:";
    },
    { message: "must be an http or https URL" },
  )
  // A trailing slash would double up when an adapter appends its endpoint path.
  .transform((value) => value.replace(/\/+$/, ""));

export const componentSelectionSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      /** Snapshot of the provider's name at selection time; display fallback. */
      name: z.string().trim().min(1),
    }),
  )
  .refine((list) => new Set(list.map((component) => component.id)).size === list.length, {
    message: "component ids must be unique",
  });

export const serviceDefinitionSchema = z.object({
  id: slug,
  name: z.string().trim().min(1),
  adapter: slug,
  baseUrl: httpUrl,
  enabled: z.boolean().default(true),
  options: z.record(z.string()).optional(),
  components: componentSelectionSchema.default([]),
  scopeToComponents: z.boolean().default(false),
});

export const pollingSchema = z.object({
  intervalMinutes: z.number().int().positive().max(1440).default(3),
  requestTimeoutSeconds: z.number().int().positive().max(120).default(8),
  maxRetries: z.number().int().positive().max(10).default(3),
  failureThreshold: z.number().int().positive().max(100).default(5),
});

export const localeSchema = z
  .string()
  .regex(/^[a-z]{2}(-[a-z0-9]+)*$/, "must be a lowercase locale tag such as en or pt-br")
  .default("en");
