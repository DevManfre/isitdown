import { z } from "zod";
import type { Candidate, ImportNote } from "./candidate.ts";

/**
 * Statping-ng's export — `statping export`, the JSON with `services`, `groups`
 * and `checkins` — roadmap 2.4.
 *
 * Its check-ins are dead-man's switches already: a service calls a URL every
 * so often, and Statping alerts when it stops. They become heartbeats.
 */

const nullableText = z
  .union([z.string(), z.object({ String: z.string().nullish(), Valid: z.boolean().nullish() }).passthrough()])
  .nullish()
  .transform((value) => (typeof value === "string" ? value : value?.Valid === false ? undefined : (value?.String ?? undefined)));

const serviceSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    domain: z.string().nullish(),
    expected: nullableText,
    expected_status: z.number().nullish(),
    check_interval: z.number().nullish(),
    type: z.string(),
    method: z.string().nullish(),
    post_data: nullableText,
    port: z.number().nullish(),
    group_id: z.number().nullish(),
    headers: nullableText,
  })
  .passthrough();

export const statpingFileSchema = z
  .object({
    services: z.array(serviceSchema),
    groups: z.array(z.object({ id: z.number(), name: z.string() }).passthrough()).nullish(),
    checkins: z.array(z.object({ name: z.string(), interval: z.number().nullish() }).passthrough()).nullish(),
  })
  .passthrough();

/** A pattern that is only literal text matches the same as a substring check. */
const REGEX_SYNTAX = /[\\^$.|?*+()[\]{}]/;

export function parseStatping(content: string): Candidate[] {
  const file = statpingFileSchema.parse(JSON.parse(content));
  const groups = new Map((file.groups ?? []).map((group) => [group.id, group.name]));

  const services = file.services.map((service): Candidate => {
    const base = {
      source: service.name,
      type: service.type,
      group: service.group_id ? groups.get(service.group_id) : undefined,
      enabled: true,
      intervalSeconds: service.check_interval ?? undefined,
      notes: [] as ImportNote[],
    };
    const domain = service.domain?.trim() ?? "";

    if (service.type === "http") {
      const method = (service.method?.trim() || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") return { ...base, skip: "unsupported-method", detail: method };
      if ((service.headers ?? "").trim() !== "" || (service.post_data ?? "").trim() !== "") {
        base.notes.push({ code: "credentials-dropped" });
      }
      const expected = service.expected?.trim() ?? "";
      if (expected !== "" && REGEX_SYNTAX.test(expected)) base.notes.push({ code: "body-pattern-dropped", detail: expected });
      return {
        ...base,
        target: {
          kind: "http",
          url: domain,
          method,
          ...(service.expected_status ? { expectStatus: String(service.expected_status) } : {}),
          ...(expected !== "" && !REGEX_SYNTAX.test(expected) ? { expectBody: expected } : {}),
        },
      };
    }

    if (service.type === "tcp") {
      if (domain === "" || !service.port) return { ...base, skip: "invalid", detail: "no host or port" };
      return { ...base, target: { kind: "tcp", host: domain.replace(/^[a-z]+:\/\//i, ""), port: service.port } };
    }

    return { ...base, skip: "unsupported-type", detail: service.type };
  });

  const checkins = (file.checkins ?? []).map(
    (checkin): Candidate => {
      const base = { source: checkin.name, type: "checkin", enabled: true, notes: [] as ImportNote[] };
      return checkin.interval
        ? { ...base, target: { kind: "heartbeat", everySeconds: checkin.interval } }
        : { ...base, skip: "no-interval" };
    },
  );

  return [...services, ...checkins];
}
