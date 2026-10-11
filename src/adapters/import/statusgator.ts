import { z } from "zod";
import type { Candidate, ImportNote } from "./candidate.ts";

/**
 * StatusGator's board monitors — roadmap 2.4.
 *
 * StatusGator is hosted, and its report exports carry monitor names only, so
 * the file read here is what its API answers for a board:
 *
 *     curl -H "Authorization: Bearer $TOKEN" \
 *       https://statusgator.com/api/v3/boards/<board>/monitors > statusgator.json
 *
 * A service monitor names the status page it watches, which is the catalog's
 * own key. Website and ping monitors are StatusGator's own checks; the list
 * answer carries their address only on newer accounts, so one without it is
 * reported rather than invented.
 */

const monitorSchema = z
  .object({
    display_name: z.string().nullish(),
    monitor_type: z.string(),
    paused_at: z.string().nullish(),
    url: z.string().nullish(),
    service: z
      .object({ name: z.string().nullish(), status_page_url: z.string().nullish() })
      .passthrough()
      .nullish(),
    group: z.object({ name: z.string().nullish() }).passthrough().nullish(),
  })
  .passthrough();

export const statusGatorFileSchema = z.union([
  z.object({ data: z.array(monitorSchema) }).passthrough(),
  z.array(monitorSchema),
]);

export function parseStatusGator(content: string): Candidate[] {
  const parsed = statusGatorFileSchema.parse(JSON.parse(content));
  const monitors = Array.isArray(parsed) ? parsed : parsed.data;

  return monitors.map((monitor): Candidate => {
    const base = {
      source: monitor.display_name ?? monitor.service?.name ?? monitor.monitor_type,
      type: monitor.monitor_type,
      group: monitor.group?.name ?? undefined,
      enabled: monitor.paused_at === null || monitor.paused_at === undefined,
      notes: [] as ImportNote[],
    };
    if (monitor.monitor_type === "ServiceMonitor") {
      const page = monitor.service?.status_page_url?.trim();
      return page ? { ...base, target: { kind: "page", url: page } } : { ...base, skip: "invalid", detail: "no status page url" };
    }
    if (monitor.monitor_type === "WebsiteMonitor") {
      const url = monitor.url?.trim();
      return url ? { ...base, target: { kind: "http", url } } : { ...base, skip: "invalid", detail: "no url in the export" };
    }
    return { ...base, skip: "unsupported-type", detail: monitor.monitor_type };
  });
}
