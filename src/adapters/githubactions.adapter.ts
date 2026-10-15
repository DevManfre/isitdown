import { z } from "zod";
import type { Adapter, FetchContext, ServiceRef } from "../core/adapter.interface.ts";
import type { Incident, NormalizedStatus, OverallStatus } from "../core/types.ts";
import { fetchConditional } from "../core/http.ts";
import { createdAtOf } from "./createdAt.ts";

/**
 * The state of a GitHub Actions workflow in a public repository (roadmap 2.13) —
 * a signal a developer cares about that no status page publishes: "main is red".
 *
 * Reads the newest *completed* run through the REST API, so a run still in
 * progress never flips the reading. `service.baseUrl` is the repository,
 * `https://github.com/owner/repo`; `options.workflow` narrows it to one workflow
 * file (`ci.yml`), `options.branch` to a branch, and `options.apiBase` points at
 * a GitHub Enterprise host or a test. The unauthenticated API allows 60 requests
 * an hour per address, which a fleet polling every few minutes will spend, so a
 * token goes in through the usual `tokenEnv` option.
 *
 * `conclusion` maps: success is operational; failure and timed_out are a major
 * outage (the build is broken); action_required and startup_failure degrade;
 * cancelled, skipped and neutral abstain — nobody decided those were bad. A
 * failed run is also reported as one incident, so the notification names the
 * run rather than saying only that a word changed.
 */
const CONCLUSIONS: Record<string, OverallStatus> = {
  success: "operational",
  failure: "major_outage",
  timed_out: "major_outage",
  startup_failure: "degraded",
  action_required: "degraded",
  stale: "degraded",
  cancelled: "unknown",
  skipped: "unknown",
  neutral: "unknown",
};

const bodySchema = z.object({
  workflow_runs: z.array(
    z.object({
      id: z.number(),
      name: z.string().nullable().optional(),
      display_title: z.string().nullable().optional(),
      conclusion: z.string().nullable().optional(),
      html_url: z.string().optional(),
      created_at: z.string().optional(),
      updated_at: z.string().optional(),
    }),
  ),
});

/** A conclusion nothing here knows reads as the worst case, like every adapter. */
function mapConclusion(conclusion: string | null | undefined): OverallStatus {
  if (conclusion === null || conclusion === undefined || conclusion === "") return "unknown";
  return CONCLUSIONS[conclusion] ?? "major_outage";
}

/** Pure mapping from the runs body to a reading, exported for the tests. */
export function parseGithubActionsStatus(raw: string, service: ServiceRef): NormalizedStatus {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`githubactions fetch ${service.id}: the body is not JSON`);
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`githubactions fetch ${service.id}: not a workflow runs document (${parsed.error.issues[0]?.message ?? "unreadable"})`);
  }
  const fetchedAt = new Date().toISOString();
  const run = parsed.data.workflow_runs[0];
  const overallStatus = run === undefined ? "unknown" : mapConclusion(run.conclusion);

  const activeIncidents: Incident[] =
    run !== undefined && overallStatus !== "operational" && overallStatus !== "unknown"
      ? [
          {
            id: String(run.id),
            name: `${run.name ?? "workflow"}: ${run.display_title ?? run.conclusion ?? ""}`.trim(),
            impact: run.conclusion ?? "",
            status: run.conclusion ?? "",
            updatedAt: run.updated_at ?? fetchedAt,
            ...createdAtOf(run.created_at),
          },
        ]
      : [];

  return { provider: service.id, overallStatus, activeIncidents, components: [], maintenances: [], fetchedAt };
}

/** The runs endpoint for the repository the operator has open in their browser. */
export function runsUrl(service: ServiceRef): string {
  const repo = /^https?:\/\/[^/]+\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(service.baseUrl.trim());
  if (repo === null) {
    throw new Error(`githubactions fetch ${service.id}: the base url must be a repository, https://github.com/owner/repo`);
  }
  const apiBase = (service.options?.["apiBase"] ?? "").trim().replace(/\/+$/, "") || "https://api.github.com";
  const workflow = (service.options?.["workflow"] ?? "").trim();
  const query = new URLSearchParams({ status: "completed", per_page: "1" });
  const branch = (service.options?.["branch"] ?? "").trim();
  if (branch !== "") query.set("branch", branch);
  const scope = workflow === "" ? "runs" : `workflows/${encodeURIComponent(workflow)}/runs`;
  return `${apiBase}/repos/${repo[1]}/actions/${scope}?${query.toString()}`;
}

export const githubActionsAdapter: Adapter = {
  id: "githubactions",
  version: 1,

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const raw = await fetchConditional(runsUrl(service), {
      providerId: service.id,
      accept: "application/vnd.github+json",
      timeoutMs: ctx.timeoutMs,
      onRead: ctx.onRead,
      auth: service.options,
      label: "githubactions fetch",
    });
    return parseGithubActionsStatus(raw, service);
  },
};
