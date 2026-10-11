import { z } from "zod";
import type { Candidate, ImportNote } from "./candidate.ts";

/**
 * Uptime Kuma's backup file — Settings → Backup → Export, the JSON with a
 * `monitorList` — roadmap 2.4.
 *
 * Read loosely, as any external JSON is: a field a newer Kuma renamed costs that
 * one option, not the whole file, and a field we never read can be anything.
 * Group monitors are not monitors here but the groups their children land in.
 */

const flag = z.union([z.boolean(), z.number()]).transform((value) => value === true || value === 1);

const monitorSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    type: z.string(),
    url: z.string().nullish(),
    method: z.string().nullish(),
    hostname: z.string().nullish(),
    port: z.number().nullish(),
    interval: z.number().nullish(),
    active: flag.nullish(),
    keyword: z.string().nullish(),
    invertKeyword: flag.nullish(),
    accepted_statuscodes: z.array(z.string()).nullish(),
    dns_resolve_type: z.string().nullish(),
    dns_resolve_server: z.string().nullish(),
    parent: z.number().nullish(),
    headers: z.string().nullish(),
    body: z.string().nullish(),
    basic_auth_user: z.string().nullish(),
    authMethod: z.string().nullish(),
  })
  .passthrough();

export const uptimeKumaFileSchema = z.object({ monitorList: z.array(monitorSchema) }).passthrough();

const text = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

export function parseUptimeKuma(content: string): Candidate[] {
  const file = uptimeKumaFileSchema.parse(JSON.parse(content));
  const groups = new Map(
    file.monitorList.filter((monitor) => monitor.type === "group").map((monitor) => [monitor.id, monitor.name]),
  );

  return file.monitorList
    .filter((monitor) => monitor.type !== "group")
    .map((monitor): Candidate => {
      const base = {
        source: monitor.name,
        type: monitor.type,
        group: monitor.parent === null || monitor.parent === undefined ? undefined : groups.get(monitor.parent),
        enabled: monitor.active ?? true,
        intervalSeconds: monitor.interval ?? undefined,
        notes: [] as ImportNote[],
      };

      switch (monitor.type) {
        case "http":
        case "keyword": {
          const url = text(monitor.url);
          if (url === undefined) return { ...base, skip: "invalid", detail: "no url" };
          const method = (text(monitor.method) ?? "GET").toUpperCase();
          if (method !== "GET" && method !== "HEAD") return { ...base, skip: "unsupported-method", detail: method };
          const authMethod = text(monitor.authMethod);
          if (
            text(monitor.headers) !== undefined ||
            text(monitor.body) !== undefined ||
            text(monitor.basic_auth_user) !== undefined ||
            (authMethod !== undefined && authMethod !== "null")
          ) {
            base.notes.push({ code: "credentials-dropped" });
          }
          const keyword = monitor.type === "keyword" ? text(monitor.keyword) : undefined;
          const statuses = (monitor.accepted_statuscodes ?? []).map((code) => code.trim()).filter((code) => code !== "");
          return {
            ...base,
            target: {
              kind: "http",
              url,
              method,
              ...(statuses.length === 0 ? {} : { expectStatus: statuses.join(",") }),
              ...(keyword === undefined ? {} : monitor.invertKeyword === true ? { absentBody: keyword } : { expectBody: keyword }),
            },
          };
        }
        case "port": {
          const host = text(monitor.hostname);
          if (host === undefined || monitor.port === null || monitor.port === undefined) {
            return { ...base, skip: "invalid", detail: "no host or port" };
          }
          return { ...base, target: { kind: "tcp", host, port: monitor.port } };
        }
        case "dns": {
          const host = text(monitor.hostname);
          if (host === undefined) return { ...base, skip: "invalid", detail: "no hostname" };
          const server = text(monitor.dns_resolve_server);
          const port = monitor.port ?? 53;
          return {
            ...base,
            target: {
              kind: "dns",
              host,
              recordType: (text(monitor.dns_resolve_type) ?? "A").toUpperCase(),
              ...(server === undefined ? {} : { resolver: port === 53 ? server : `${server}:${port}` }),
            },
          };
        }
        case "push": {
          if (monitor.interval === null || monitor.interval === undefined) return { ...base, skip: "no-interval" };
          return { ...base, target: { kind: "heartbeat", everySeconds: monitor.interval } };
        }
        default:
          return { ...base, skip: "unsupported-type", detail: monitor.type };
      }
    });
}
