import type { Adapter, FetchContext, ServiceRef } from "../core/adapter.interface.ts";
import type { NormalizedStatus, OverallStatus } from "../core/types.ts";
import { USER_AGENT } from "../core/http.ts";

/**
 * Whether a public package registry answers (roadmap 2.13), measured the way a
 * client meets it: by asking for the metadata of a real package, not by pinging
 * the host. A registry whose front page loads while its API returns 502 is down
 * for everyone who installs from it.
 *
 * A probe, like `http`: the registry is the subject, so a refused connection, a
 * timeout or a 5xx is the *reading* rather than a failure to get one, and
 * nothing here throws. `service.baseUrl` is the registry's API origin
 * (`https://registry.npmjs.org`, `https://pypi.org`, `https://hub.docker.com`),
 * `options.registry` says which protocol it speaks (`npm`, `pypi`,
 * `dockerhub`), and `options.package` names the package to ask for — one the
 * operator depends on, so the reading is also "can I still fetch my package".
 *
 * Severity: a 2xx whose body is JSON is operational. A 404 degrades — the
 * registry answered, the package is gone or misspelt, which is the operator's
 * to look at and not an outage. A 2xx that is not JSON degrades (a captive
 * page or a proxy error in front of the registry). A 429 abstains: we were
 * asked to slow down, which says nothing about their health. Everything else —
 * unreachable, 5xx, any other 4xx — is a major outage.
 */
const REGISTRIES = ["npm", "pypi", "dockerhub"] as const;
type Registry = (typeof REGISTRIES)[number];

function isRegistry(value: string): value is Registry {
  return (REGISTRIES as readonly string[]).includes(value);
}

/** The metadata url of a package, null when the options cannot name one. */
export function metadataUrl(service: ServiceRef): string | null {
  const registry = (service.options?.["registry"] ?? "").trim();
  const name = (service.options?.["package"] ?? "").trim();
  if (!isRegistry(registry) || name === "") return null;
  const base = service.baseUrl.replace(/\/+$/, "");
  switch (registry) {
    case "npm":
      // A scoped name keeps its slash encoded: `/@scope/name` is a different route.
      return `${base}/${name.replace("/", "%2f")}`;
    case "pypi":
      return `${base}/pypi/${encodeURIComponent(name)}/json`;
    case "dockerhub":
      return `${base}/v2/repositories/${name}/`;
  }
}

function reading(service: ServiceRef, overallStatus: OverallStatus): NormalizedStatus {
  return {
    provider: service.id,
    overallStatus,
    activeIncidents: [],
    components: [],
    maintenances: [],
    fetchedAt: new Date().toISOString(),
  };
}

export const registryAdapter: Adapter = {
  id: "registry",
  version: 1,
  kind: "probe",

  validateOptions(options) {
    const problems: string[] = [];
    const registry = (options?.["registry"] ?? "").trim();
    if (!isRegistry(registry)) problems.push(`registry must be one of ${REGISTRIES.join(", ")}`);
    if ((options?.["package"] ?? "").trim() === "") problems.push("package is required: the package whose metadata is asked for");
    return problems;
  },

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const url = metadataUrl(service);
    if (url === null) {
      // A misconfigured probe is not a registry outage: say what is wrong.
      throw new Error(`registry fetch ${service.id}: options.registry (${REGISTRIES.join("|")}) and options.package are required`);
    }

    let response: Response;
    const askedAt = Date.now();
    try {
      response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": USER_AGENT },
        cache: "no-store",
        signal: AbortSignal.timeout(ctx.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      ctx.onNote?.({ text: `no answer from ${url}: ${reason}`, unreachable: true });
      return reading(service, "major_outage");
    }
    ctx.onRead?.({ latencyMs: Date.now() - askedAt, notModified: false });

    if (response.status === 429) {
      ctx.onNote?.({ text: `${url} asked us to slow down (429)` });
      return reading(service, "unknown");
    }
    if (response.status === 404) {
      ctx.onNote?.({ text: `the registry answered, but has no package ${service.options?.["package"] ?? ""}` });
      return reading(service, "degraded");
    }
    if (!response.ok) {
      ctx.onNote?.({ text: `${url} answered ${response.status}` });
      return reading(service, "major_outage");
    }
    try {
      const body: unknown = JSON.parse(await response.text());
      if (body !== null && typeof body === "object" && Object.keys(body).length > 0) return reading(service, "operational");
    } catch {
      // fall through: a 2xx that is not metadata
    }
    ctx.onNote?.({ text: `${url} answered 2xx, but not with package metadata` });
    return reading(service, "degraded");
  },
};
