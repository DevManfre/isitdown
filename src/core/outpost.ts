import { z } from "zod";
import type { ReadingNote, ServiceRef } from "./adapter.interface.ts";
import { USER_AGENT } from "./http.ts";
import { normalizedStatusSchema } from "./status.schema.ts";
import type { NormalizedStatus, OverallStatus } from "./types.ts";

/**
 * A second point of view for probes — roadmap 1.7.
 *
 * A probe that fails says "unreachable *from this container's network*", which
 * is not the same sentence as "down". An outpost is a stateless worker on some
 * other network (a small VPS, a second site) that takes one probe reading when
 * asked and hands it back. The poller asks every outpost alongside its own
 * reading and keeps what a majority agrees on.
 *
 * The poller does the asking, not the outpost the pushing: the main instance
 * usually sits behind NAT on a home or office network, and the Light edition
 * has no HTTP server at all, so only the direction where the outpost is the
 * one listening works for both editions. It also keeps the outpost free of
 * configuration — every request carries the probe it is asked to run.
 *
 * Opt-in by construction: with no outpost configured the poller never reaches
 * this file and nothing about a reading changes.
 */

export interface Outpost {
  /** The URL's host, which is what a note names it by. */
  id: string;
  url: string;
  token: string;
}

/**
 * The outposts this installation asks, read from the environment.
 *
 * `OUTPOSTS` is a comma-separated list of base URLs; `OUTPOST_TOKEN` is the
 * bearer every one of them was started with. One token for the fleet rather
 * than one each: an operator deploys the same container to every VPS, and a
 * per-outpost secret would be a second list to keep in step with the first.
 *
 * Throws on a list that cannot work — a URL that is not one, or outposts with
 * no token — because an installation that silently ignored its outposts would
 * keep alerting on single readings while the operator believed otherwise.
 */
export function readOutposts(env: NodeJS.ProcessEnv): Outpost[] {
  const raw = env["OUTPOSTS"]?.trim() ?? "";
  if (raw === "") return [];
  const token = env["OUTPOST_TOKEN"]?.trim() ?? "";
  if (token === "") throw new Error("OUTPOSTS is set but OUTPOST_TOKEN is not");

  const outposts: Outpost[] = [];
  for (const entry of raw.split(",").map((part) => part.trim()).filter((part) => part !== "")) {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`OUTPOSTS: "${entry}" is not a URL`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`OUTPOSTS: "${entry}" must be an http or https URL`);
    }
    if (outposts.some((outpost) => outpost.id === url.host)) {
      throw new Error(`OUTPOSTS: "${url.host}" is listed more than once`);
    }
    outposts.push({ id: url.host, url: entry.replace(/\/+$/, ""), token });
  }
  return outposts;
}

/** What the poller sends: one probe, fully described, nothing remembered. */
export const outpostRequestSchema = z.object({
  adapter: z.string().min(1),
  service: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    baseUrl: z.string().min(1),
    options: z.record(z.string()).optional(),
  }),
  timeoutMs: z.number().int().positive().max(120_000),
});
export type OutpostRequest = z.infer<typeof outpostRequestSchema>;

/** What an outpost answers with when the probe ran, whatever it found. */
export const outpostResponseSchema = z.object({
  status: normalizedStatusSchema,
  note: z.object({ text: z.string(), unreachable: z.boolean().optional() }).optional(),
});
export type OutpostResponse = z.infer<typeof outpostResponseSchema>;

/** One outpost's part in a reading: what it saw, or why it saw nothing. */
export type OutpostReading =
  | { outpost: string; status: NormalizedStatus; note?: string | undefined }
  | { outpost: string; error: string };

/**
 * Asks one outpost for one probe reading. Never rejects: an outpost that is
 * down, slow, misconfigured or answering nonsense abstains, and the reason
 * travels with it so the diagnostics panel can say which one and why.
 *
 * No retries. The outpost's own reading is a single attempt by design — the
 * poller's retries exist for the local read, and stacking a second set here
 * would let one slow outpost hold the whole provider past its cadence.
 */
export async function askOutpost(
  outpost: Outpost,
  adapter: string,
  service: ServiceRef,
  timeoutMs: number,
): Promise<OutpostReading> {
  const body: OutpostRequest = {
    adapter,
    service: {
      id: service.id,
      name: service.name,
      baseUrl: service.baseUrl,
      ...(service.options === undefined ? {} : { options: service.options }),
    },
    timeoutMs,
  };
  try {
    const response = await fetch(`${outpost.url}/probe`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${outpost.token}`,
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify(body),
      // The outpost's own probe may take the whole timeout; the round trip to
      // it gets a little more on top rather than cutting off a slow answer.
      signal: AbortSignal.timeout(timeoutMs + 2_000),
    });
    if (!response.ok) return { outpost: outpost.id, error: `answered HTTP ${response.status}` };
    const parsed = outpostResponseSchema.safeParse(await response.json());
    if (!parsed.success) return { outpost: outpost.id, error: "answered with an unexpected shape" };
    return { outpost: outpost.id, status: parsed.data.status, note: parsed.data.note?.text };
  } catch (error) {
    return { outpost: outpost.id, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Severity worst last; `unknown` is no opinion, so it never votes. */
const RANK: OverallStatus[] = ["operational", "degraded", "partial_outage", "major_outage"];

export interface ConsensusInput {
  status: NormalizedStatus;
  note?: ReadingNote | undefined;
}

/**
 * The reading a majority of observation points agrees on.
 *
 * Every point that saw something votes — this container and each outpost that
 * answered. The result is the worst severity a strict majority sees as at
 * least that bad: with three votes it is the middle one, so "down" takes two
 * of three; with two it is the better one, so one outpost alone can veto a
 * local "down" but cannot invent one. An outpost that did not answer does not
 * vote and is never counted as "down": its own network failing is exactly the
 * kind of single-vantage noise this exists to filter out.
 *
 * The local reading stays the one returned whenever it already is the
 * majority's severity, so its latency and note carry on unchanged; only when
 * the vote overturns it does an outpost's reading take its place, with the
 * local `provider` and `fetchedAt` so the record still reads as this poll.
 */
export function decideByConsensus(local: ConsensusInput, remote: OutpostReading[]): ConsensusInput {
  if (remote.length === 0) return local;
  const tally = describeVotes(local, remote);

  // A local `unknown` is no opinion, and the outposts alone are not a majority
  // of anything this container saw: the reading stands as it was.
  if (local.status.overallStatus === "unknown") return withTally(local, remote, tally);

  const votes: NormalizedStatus[] = [local.status];
  for (const reading of remote) {
    if ("status" in reading && reading.status.overallStatus !== "unknown") votes.push(reading.status);
  }
  const sorted = [...votes].sort(
    (a, b) => RANK.indexOf(b.overallStatus) - RANK.indexOf(a.overallStatus),
  );
  const decided = sorted[Math.floor(votes.length / 2)]?.overallStatus ?? local.status.overallStatus;
  if (decided === local.status.overallStatus) return withTally(local, remote, tally);

  const winner = votes.find((vote) => vote.overallStatus === decided) ?? local.status;
  return {
    status: { ...winner, provider: local.status.provider, fetchedAt: local.status.fetchedAt },
    note: {
      text: `${localText(local)} — overruled by the outposts: ${tally}`,
      // The target answered somebody; whatever stopped it reaching us is ours.
      ...(decided !== "operational" && local.note?.unreachable === true ? { unreachable: true } : {}),
    },
  };
}

function localText(local: ConsensusInput): string {
  return local.note?.text ?? `${local.status.overallStatus} from here`;
}

/**
 * One line naming every point of view, so an operator reading the diagnostics
 * panel can see who said what — and which outposts said nothing at all.
 */
function describeVotes(local: ConsensusInput, remote: OutpostReading[]): string {
  const parts = [`here ${local.status.overallStatus}`];
  for (const reading of remote) {
    parts.push(
      "status" in reading
        ? `${reading.outpost} ${reading.status.overallStatus}`
        : `${reading.outpost} did not answer (${reading.error})`,
    );
  }
  return parts.join(", ");
}

/**
 * The local reading kept, with the tally added only when there is something
 * worth reading in it: an outpost that disagreed or said nothing. Unanimity is
 * the normal case and says nothing a note should.
 */
function withTally(local: ConsensusInput, remote: OutpostReading[], tally: string): ConsensusInput {
  const dissent = remote.some(
    (reading) => !("status" in reading) || reading.status.overallStatus !== local.status.overallStatus,
  );
  if (!dissent) return local;
  return {
    status: local.status,
    note: {
      text: `${localText(local)} — outposts: ${tally}`,
      ...(local.note?.unreachable === true ? { unreachable: true } : {}),
    },
  };
}
