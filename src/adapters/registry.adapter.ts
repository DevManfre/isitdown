import type { Adapter, FetchContext, ServiceRef } from "../core/adapter.interface.ts";
import type { NormalizedStatus, OverallStatus } from "../core/types.ts";
import { USER_AGENT } from "../core/http.ts";
import { MAX_BODY_BYTES, readCapped } from "../core/outboundPolicy.ts";

/**
 * Whether a public package registry or CDN answers, and whether a package you
 * depend on has moved on (roadmap 2.13). Measured the way a client meets it: by
 * asking for the metadata of a real package, not by pinging the host. A registry
 * whose front page loads while its API returns 502 is down for everyone who
 * installs from it.
 *
 * A probe, like `http`: the registry is the subject, so a refused connection, a
 * timeout or a 5xx is the *reading* rather than a failure to get one, and
 * nothing here throws on them. `service.baseUrl` is the API origin
 * (`https://registry.npmjs.org`, `https://pypi.org`, `https://hub.docker.com`,
 * `https://crates.io`, `https://data.jsdelivr.com`, `https://api.cdnjs.com`,
 * `https://unpkg.com`), `options.registry` says which protocol it speaks and
 * `options.package` names the package to ask for — one the operator depends on,
 * so the reading is also "can I still fetch my package".
 *
 * Severity: a 2xx whose body is JSON is operational. A 404 degrades — the
 * registry answered, the package is gone or misspelt, the operator's to look at.
 * A 2xx that is not JSON degrades (a captive page or a proxy error in front).
 * A 429 abstains: we were asked to slow down, which says nothing about their
 * health. Everything else — unreachable, 5xx, any other 4xx — is a major outage.
 *
 * `options.pinned` adds the release signal: the version the operator depends
 * on, `1` or `1.4.2`. When the registry's latest version has a higher *major*
 * the reading degrades and one incident says so — "left-pad 2.0.0 is out, you
 * pin 1.x". It is not downtime, but it is the thing a developer wants to hear
 * about, and it clears when the pin is raised. Stateless: it compares against
 * the pin, not against what was seen last. Docker Hub has no version to compare
 * and refuses the option.
 */
const REGISTRIES = ["npm", "pypi", "dockerhub", "crates", "jsdelivr", "cdnjs", "unpkg"] as const;
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
    case "crates":
      return `${base}/api/v1/crates/${encodeURIComponent(name)}`;
    case "jsdelivr":
      return `${base}/v1/packages/npm/${name}`;
    case "cdnjs":
      return `${base}/libraries/${encodeURIComponent(name)}?fields=version`;
    case "unpkg":
      return `${base}/${name}/package.json`;
  }
}

/** The latest version a registry's metadata names, null when it names none. */
export function latestVersion(registry: Registry, body: unknown): string | null {
  const at = (value: unknown, ...path: string[]): unknown =>
    path.reduce<unknown>((node, key) => (node !== null && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), value);
  const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
  switch (registry) {
    case "npm":
      return text(at(body, "dist-tags", "latest"));
    case "pypi":
      return text(at(body, "info", "version"));
    case "crates":
      return text(at(body, "crate", "max_stable_version")) ?? text(at(body, "crate", "max_version"));
    case "jsdelivr": {
      const versions = at(body, "versions");
      return Array.isArray(versions) ? text(at(versions[0], "version")) ?? text(versions[0]) : null;
    }
    case "cdnjs":
    case "unpkg":
      return text(at(body, "version"));
    case "dockerhub":
      return null;
  }
}

const majorOf = (version: string): number | null => {
  const major = /^v?(\d+)/.exec(version.trim())?.[1];
  return major === undefined ? null : Number(major);
};

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

/** The release signal: a latest major above the operator's pin degrades the reading. */
function withRelease(service: ServiceRef, base: NormalizedStatus, body: unknown): NormalizedStatus {
  const pinned = (service.options?.["pinned"] ?? "").trim();
  const registry = (service.options?.["registry"] ?? "").trim();
  if (pinned === "" || !isRegistry(registry)) return base;
  const latest = latestVersion(registry, body);
  const have = majorOf(pinned);
  const got = latest === null ? null : majorOf(latest);
  if (latest === null || have === null || got === null || got <= have) return base;
  const name = service.options?.["package"] ?? "";
  return {
    ...base,
    overallStatus: "degraded",
    activeIncidents: [
      {
        id: `${name}@${latest}`,
        name: `${name} ${latest} is out, you pin ${pinned}`,
        impact: "release",
        status: "new-major",
        updatedAt: base.fetchedAt,
      },
    ],
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
    const pinned = (options?.["pinned"] ?? "").trim();
    if (pinned !== "" && majorOf(pinned) === null) problems.push("pinned must start with a version number, e.g. 1 or 1.4.2");
    if (pinned !== "" && registry === "dockerhub") problems.push("pinned cannot be used with dockerhub: it has no version to compare");
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
      const body: unknown = JSON.parse(new TextDecoder().decode(await readCapped(response, MAX_BODY_BYTES)));
      if (body !== null && typeof body === "object" && Object.keys(body).length > 0) {
        return withRelease(service, reading(service, "operational"), body);
      }
    } catch {
      // fall through: a 2xx that is not metadata
    }
    ctx.onNote?.({ text: `${url} answered 2xx, but not with package metadata` });
    return reading(service, "degraded");
  },
};
