import { request } from "node:http";
import { request as requestTls } from "node:https";
import { z } from "zod";
import type { Adapter, ComponentPreview, FetchContext, ServiceRef } from "../core/adapter.interface.ts";
import type { ComponentStatus, NormalizedStatus, OverallStatus } from "../core/types.ts";

/**
 * Container state from a Docker engine — roadmap 2.6, the homelab's other
 * question: is the stack itself up, not just the page it serves.
 *
 * One provider is one engine; its containers are components, picked in the
 * same picker a status page's components are. The engine is reached the way
 * the operator chose to expose it:
 *
 * - `baseUrl` `http://docker-socket-proxy:2375` — a socket proxy that answers
 *   only `GET /containers` is the recommended way: the Docker API has no
 *   read-only mode, and mounting the socket `:ro` does not make it one.
 * - `baseUrl` `http://localhost` with `options.socket` `/var/run/docker.sock` —
 *   the socket mounted into the container, which is full control of the daemon.
 *
 * One request per reading — `GET /containers/json?all=1` — and the state comes
 * from its `State` and `Status` fields, the latter carrying the health check's
 * verdict ("Up 2 hours (healthy)"), so no per-container call is needed.
 *
 * Two readings of one list, deliberately different:
 *
 * - **The whole engine**, nothing selected or not scoped: only containers that
 *   are running or trying to count. A stopped container is as likely a one-shot
 *   job that finished as a service that died, and an engine whose finished
 *   migration container kept it red forever would teach the operator to ignore
 *   it.
 * - **A selected container** is strict: it was picked because it should be up,
 *   so anything but running is an outage.
 */

/** The option keys this adapter reads, for the settings form and the docs. */
export const DOCKER_OPTION_KEYS = ["socket"] as const;

const containerSchema = z
  .object({
    Id: z.string(),
    Names: z.array(z.string()).default([]),
    State: z.string().default(""),
    Status: z.string().default(""),
    Labels: z.record(z.string()).nullish(),
  })
  .passthrough();

const listSchema = z.array(containerSchema);

type Container = z.infer<typeof containerSchema>;

const nameOf = (container: Container): string => (container.Names[0] ?? container.Id.slice(0, 12)).replace(/^\//, "");

/** Health check verdict carried in `Status`, if the container has one. */
function healthOf(container: Container): "healthy" | "unhealthy" | "starting" | null {
  if (/\(unhealthy\)/.test(container.Status)) return "unhealthy";
  if (/\(health: starting\)/.test(container.Status)) return "starting";
  if (/\(healthy\)/.test(container.Status)) return "healthy";
  return null;
}

/** A selected container: anything but running is an outage. */
export function strictStatus(container: Container): OverallStatus {
  switch (container.State) {
    case "running": {
      const health = healthOf(container);
      if (health === "unhealthy") return "major_outage";
      // Still inside its start period: not evidence either way yet.
      if (health === "starting") return "unknown";
      return "operational";
    }
    case "paused":
      return "degraded";
    default:
      // restarting (a crash loop), exited, dead, created, removing.
      return "major_outage";
  }
}

/** The whole engine: a container that is not trying to run abstains. */
export function lenientStatus(container: Container): OverallStatus {
  return container.State === "running" || container.State === "restarting" || container.State === "paused"
    ? strictStatus(container)
    : "unknown";
}

/**
 * One container down out of ten is a partial outage of the engine, not a major
 * one — the same header rule a status page applies. `unknown` abstains, and an
 * engine where everything abstains is `unknown`.
 */
function fold(statuses: OverallStatus[]): OverallStatus {
  const known = statuses.filter((status) => status !== "unknown");
  if (known.length === 0) return "unknown";
  const down = known.filter((status) => status === "major_outage").length;
  if (down === known.length) return "major_outage";
  if (down > 0) return "partial_outage";
  return known.some((status) => status === "degraded") ? "degraded" : "operational";
}

function parseList(raw: string, service: ServiceRef): Container[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`docker read for ${service.id} returned a body that is not JSON`);
  }
  const parsed = listSchema.safeParse(json);
  if (!parsed.success) throw new Error(`docker read for ${service.id} returned something other than a container list`);
  return parsed.data;
}

/** Pure mapping from the list body to a reading, exported for the tests. */
export function parseDockerStatus(raw: string, service: ServiceRef): NormalizedStatus {
  const containers = parseList(raw, service);
  const byName = new Map(containers.map((container) => [nameOf(container), container]));
  const components: ComponentStatus[] = (service.components ?? []).map((selection) => {
    const container = byName.get(selection.id);
    // A selected container that no longer exists at all is not running either.
    return { id: selection.id, name: selection.name, status: container === undefined ? "major_outage" : strictStatus(container) };
  });
  const scoped = service.scopeToComponents === true && components.length > 0;
  return {
    provider: service.id,
    overallStatus: fold(scoped ? components.map((component) => component.status) : containers.map(lenientStatus)),
    activeIncidents: [],
    components,
    maintenances: [],
    fetchedAt: new Date().toISOString(),
  };
}

/** Pure mapping from the list body to the picker's rows, grouped by compose project. */
export function parseDockerComponents(raw: string, service: ServiceRef): ComponentPreview[] {
  return parseList(raw, service)
    .map((container) => ({
      id: nameOf(container),
      name: nameOf(container),
      group: container.Labels?.["com.docker.compose.project"] ?? null,
      showcase: false,
      status: strictStatus(container),
    }))
    .sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.name.localeCompare(b.name));
}

/** `options.socket`, if given, as an absolute path. */
function socketOf(service: ServiceRef): string | undefined {
  const socket = service.options?.["socket"]?.trim();
  return socket === undefined || socket === "" ? undefined : socket;
}

/**
 * `GET /containers/json?all=1` against the engine. Throws on anything that is
 * not a 2xx answer, like a page read: an engine we cannot reach is a reading we
 * do not have, not evidence that every container stopped.
 */
export function readContainers(service: ServiceRef, timeoutMs: number): Promise<{ body: string; latencyMs: number }> {
  const url = new URL(`${service.baseUrl}/containers/json?all=1`);
  const socketPath = socketOf(service);
  const send = url.protocol === "https:" && socketPath === undefined ? requestTls : request;
  const askedAt = Date.now();
  return new Promise((resolve, reject) => {
    const req = send(
      {
        ...(socketPath === undefined
          ? { host: url.hostname, port: url.port === "" ? undefined : Number(url.port) }
          : { socketPath }),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { accept: "application/json", host: socketPath === undefined ? url.host : "docker" },
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            reject(new Error(`docker read for ${service.id}: the engine answered ${status}`));
            return;
          }
          resolve({ body, latencyMs: Date.now() - askedAt });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`docker read for ${service.id}: timed out`)));
    req.on("error", (error) => reject(new Error(`docker read for ${service.id}: ${error.message}`)));
    req.end();
  });
}

export const dockerAdapter: Adapter = {
  id: "docker",
  version: 1,
  // Our own reading of the containers, not a page someone else publishes.
  kind: "probe",

  validateOptions(options) {
    const socket = options?.["socket"]?.trim();
    return socket !== undefined && socket !== "" && !socket.startsWith("/")
      ? ["socket must be an absolute path, e.g. /var/run/docker.sock"]
      : [];
  },

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const { body, latencyMs } = await readContainers(service, ctx.timeoutMs);
    ctx.onRead?.({ latencyMs, notModified: false });
    const status = parseDockerStatus(body, service);
    const down = status.components.filter((component) => component.status === "major_outage");
    if (down.length > 0) ctx.onNote?.({ text: `not running: ${down.map((component) => component.id).join(", ")}` });
    return status;
  },

  async listComponents(service: ServiceRef, ctx: FetchContext): Promise<ComponentPreview[]> {
    return parseDockerComponents((await readContainers(service, ctx.timeoutMs)).body, service);
  },
};
