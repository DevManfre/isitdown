import { z } from "zod";
import type { IncidentFilter } from "../historyStore.interface.ts";
import type { UiRuntimeCore } from "../runtime.ts";

/**
 * How the incident list's filters are read off a request.
 *
 * Shared by `/incidents` and `/export/incidents.*` on purpose (roadmap 4.6):
 * an export that parsed its own filters would eventually disagree with the
 * search the operator was looking at when they asked for it, and the export is
 * meant to be that search's own result.
 */
export const DEFAULT_PAGE_SIZE = 20;
/** An unbounded page size would let one request undo the paging entirely. */
export const MAX_PAGE_SIZE = 100;

/**
 * A bad page number is a stale bookmark or a hand-edited URL, not something
 * worth failing the whole list over: every one of these falls back to the first
 * page of everything rather than a 400, the way the notification feed's limit
 * does.
 */
export const pageSchema = z.coerce.number().int().positive().catch(1);
export const pageSizeSchema = z.coerce
  .number()
  .int()
  .positive()
  .catch(DEFAULT_PAGE_SIZE)
  .transform((value) => Math.min(value, MAX_PAGE_SIZE));
export const stateSchema = z.enum(["all", "active", "resolved"]).catch("all");
/**
 * Free text over incident names, and the window it is searched in (roadmap
 * 5.19). Both fall back to "no narrowing" on anything unusable, like the paging
 * parameters above: a hand-edited URL should show the unfiltered list, not an
 * error page.
 *
 * The search string is bounded because it becomes a `LIKE` pattern scanned over
 * every row a long retention has accumulated.
 */
export const querySchema = z
  .string()
  .max(120)
  .catch("")
  .transform((value) => value.trim());
export const daysSchema = z.coerce.number().int().positive().max(3650).catch(0);

export interface IncidentQuery {
  /** What the operator sees, echoed back so an export can name its own filter. */
  provider: string | null;
  state: "all" | "active" | "resolved";
  query: string;
  days: number;
  /** The store filter the three above add up to, without paging. */
  filter: IncidentFilter;
}

/**
 * A disabled provider is not being watched, so its incidents are not news: the
 * allow-list goes into the query rather than over the answer, because the page,
 * the pager's total and the pills' counts all come from the server and would
 * otherwise still be counting it.
 */
export function readIncidentQuery(
  query: Record<string, unknown>,
  runtime: UiRuntimeCore,
): IncidentQuery {
  const provider = query["provider"];
  const scoped = typeof provider === "string" && provider !== "" ? provider : null;
  const state = stateSchema.parse(query["state"] ?? undefined);
  const text = querySchema.parse(query["q"] ?? undefined);
  const days = daysSchema.parse(query["days"] ?? undefined);

  return {
    provider: scoped,
    state,
    query: text,
    days,
    filter: {
      ...(scoped === null ? {} : { providerId: scoped }),
      providerIds: runtime.enabledProviderIds(),
      ...(text === "" ? {} : { query: text }),
      ...(days === 0 ? {} : { days }),
    },
  };
}
