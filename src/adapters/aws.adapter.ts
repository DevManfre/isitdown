import { z } from "zod";
import type { Adapter, FetchContext, ServiceRef } from "../core/adapter.interface.ts";
import { fetchConditional } from "../core/http.ts";
import type { Incident, NormalizedStatus, OverallStatus } from "../core/types.ts";
import { worstStatus } from "./severity.ts";

/**
 * AWS runs no Statuspage. Its public health dashboard is backed by one JSON
 * document, `/public/currentevents`, holding the events that are open right
 * now — a resolved event simply drops out of it, so there is no history to
 * backfill from and no `fetchIncidentHistory` here.
 *
 * Two things about that feed are unusual enough to be worth naming. It is
 * served as UTF-16 (handled once, in `src/core/http.ts`), and every event is
 * scoped to one region, so a fleet in `eu-west-1` sees every other region's
 * trouble unless it says which one it cares about — hence the `region` option.
 *
 * Severity is a numeric code rather than words, so unlike the feed and Slack
 * adapters this one reads the provider's own dial instead of guessing from
 * wording.
 */

const EVENTS_PATH = "/public/currentevents";

/**
 * The dashboard's own legend. `0` is an event that has been closed out — it is
 * kept in the map because a closed event can still be in the document for a
 * cycle or two, and reading it as trouble would keep a recovered region red.
 */
const STATUS_CODES: Record<string, OverallStatus> = {
  "0": "operational",
  "1": "operational",
  "2": "degraded",
  "3": "major_outage",
};

/**
 * AWS's word for each code, kept unnormalised like every other adapter's so a
 * notifier can quote the provider rather than us.
 */
const STATUS_WORDS: Record<string, string> = {
  "0": "resolved",
  "1": "informational",
  "2": "degradation",
  "3": "disruption",
};

/**
 * `1` is the blue "informational message" on the dashboard: an advisory, not an
 * outage. It is still surfaced as an incident so the operator sees it, but on
 * its own it does not move the region's status.
 */
const INFORMATIONAL = "1";

/** A closed event is dropped rather than reported: it is over. */
const CLOSED = "0";

/**
 * Deliberately lenient about individual fields — a dropped `summary` is not an
 * outage of our own — while still rejecting a body that is not this feed at all.
 */
const eventSchema = z.object({
  arn: z.string().optional(),
  date: z.union([z.string(), z.number()]).optional(),
  status: z.union([z.string(), z.number()]).optional(),
  service: z.string().optional(),
  service_name: z.string().optional(),
  region_name: z.string().optional(),
  summary: z.string().optional(),
  event_log: z
    .array(
      z.object({
        summary: z.string().optional(),
        message: z.string().optional(),
        status: z.union([z.string(), z.number()]).optional(),
        timestamp: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .optional()
    .catch(undefined),
});

const eventsSchema = z.array(eventSchema);

type AwsEvent = z.infer<typeof eventSchema>;

const codeOf = (event: AwsEvent): string => (event.status === undefined ? "" : String(event.status));

function severityOf(event: AwsEvent): OverallStatus {
  // An unknown code reads as an outage: silently downgrading one to operational
  // is the single failure mode that matters here.
  return STATUS_CODES[codeOf(event)] ?? "major_outage";
}

/**
 * Epoch timestamps arrive in seconds on an event and in milliseconds on a
 * status change, in both cases sometimes as a string.
 */
function toIso(raw: string | number | undefined): string | null {
  if (raw === undefined || raw === "") return null;
  const epoch = Number(raw);
  if (!Number.isFinite(epoch)) return null;
  const ms = epoch < 1e12 ? epoch * 1000 : epoch;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The last thing AWS said about an event, which is what "updated" means here. */
function lastUpdate(event: AwsEvent): string | null {
  const stamps = (event.event_log ?? [])
    .map((entry) => toIso(entry.timestamp))
    .filter((stamp): stamp is string => stamp !== null);
  const newest = stamps.reduce<string | null>((max, stamp) => (max === null || stamp > max ? stamp : max), null);
  return newest ?? toIso(event.date);
}

/**
 * Which region an event belongs to. The region is in the ARN
 * (`arn:aws:health:eu-west-1::event/...`) and repeated as a suffix on the
 * service key (`ec2-eu-west-1`); the ARN is the authoritative one, the suffix
 * the fallback for an event that arrived without it.
 */
function regionOf(event: AwsEvent): string | null {
  const fromArn = /^arn:aws[\w-]*:health:([a-z0-9-]+):/.exec(event.arn ?? "")?.[1];
  if (fromArn !== undefined && fromArn !== "") return fromArn;
  const fromService = /-([a-z]{2}(?:-[a-z]+)+-\d)$/.exec(event.service ?? "")?.[1];
  return fromService ?? null;
}

/**
 * Pure mapping from the feed to a status reading, exported for the tests.
 *
 * `service.options.region` narrows it to one region. A global event — one the
 * feed publishes with no region at all — is always reported: it is the case
 * where narrowing would hide exactly the outage that matters most.
 */
export function parseAwsStatus(raw: string, service: ServiceRef): NormalizedStatus {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`aws fetch for ${service.id} returned a body that is not JSON`);
  }
  const parsed = eventsSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`aws fetch for ${service.id} returned a body that is not an event list`);
  }

  const region = service.options?.["region"];
  const fetchedAt = new Date().toISOString();

  const events = parsed.data.filter((event) => {
    if (event.arn === undefined || codeOf(event) === CLOSED) return false;
    if (region === undefined || region === "") return true;
    const eventRegion = regionOf(event);
    return eventRegion === null || eventRegion === region;
  });

  const activeIncidents: Incident[] = events.map((event) => ({
    id: event.arn!,
    // The dashboard reads "Increased Error Rates" next to the service and the
    // region, and an incident named by its symptom alone is unplaceable in a
    // notification, so the name carries all three.
    name: [event.service_name, event.region_name, event.summary].filter((part) => part !== undefined).join(" — "),
    impact: severityOf(event),
    status: STATUS_WORDS[codeOf(event)] ?? "disruption",
    updatedAt: lastUpdate(event) ?? fetchedAt,
  }));

  return {
    provider: service.id,
    overallStatus: worstStatus(events.filter((event) => codeOf(event) !== INFORMATIONAL).map(severityOf)),
    activeIncidents,
    // The feed names the services an open event has hit, but publishes nothing
    // at all while a region is healthy — a picker fed from it would be empty
    // exactly when an operator goes looking for one, so there is no
    // `listComponents` and no component reporting here.
    components: [],
    // Nor any scheduled-maintenance data: AWS announces those through Service
    // Health, per account, not on the public feed.
    maintenances: [],
    fetchedAt,
  };
}

export const awsAdapter: Adapter = {
  id: "aws",

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const raw = await fetchConditional(`${service.baseUrl}${EVENTS_PATH}`, {
      providerId: service.id,
      accept: "application/json",
      timeoutMs: ctx.timeoutMs,
      onRead: ctx.onRead,
      label: "aws fetch",
    });
    return parseAwsStatus(raw, service);
  },
};
