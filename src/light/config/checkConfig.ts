import { adapters } from "../../adapters/index.ts";
import { detectAdapter } from "../../adapters/detect.ts";
import type { RuntimeConfig } from "../../core/configSource.interface.ts";
import { inspectConfig } from "./loadConfig.ts";

/**
 * What the `check` command reports about a `config.yml` (roadmap 6.12).
 *
 * Validating a file today means starting the container and reading its logs,
 * which tells the operator about the first problem only and costs a container
 * to learn it. Everything the loader refuses to start on is collected here
 * instead, plus the two questions the loader never asks: whether an adapter by
 * that name exists, and — with `--probe` — whether the base url is a page any
 * adapter recognises.
 */
export interface CheckFinding {
  /** An error fails the check; a warning is worth saying and not worth failing on. */
  level: "error" | "warning";
  message: string;
}

export interface CheckReport {
  findings: CheckFinding[];
  /** Services declared, and how many of them are enabled. */
  services: number;
  enabledServices: number;
  /** Ids of the channels the file switches on. */
  enabledChannels: string[];
  /** Whether the file probed the fleet, so the caller can say the check was offline. */
  probed: boolean;
  ok: boolean;
}

export interface CheckOptions {
  path: string;
  env: NodeJS.ProcessEnv;
  /**
   * Read every enabled provider's page and say which adapter it looks like.
   * Off by default: a check that reaches the network is not something CI can
   * depend on, and every other finding here is answerable from the file alone.
   */
  probe?: boolean | undefined;
}

export async function checkConfig(options: CheckOptions): Promise<CheckReport> {
  const { problems, config } = await inspectConfig(options.path, options.env);
  const findings: CheckFinding[] = problems.map((message) => ({ level: "error", message }));

  if (config === null) {
    return {
      findings,
      services: 0,
      enabledServices: 0,
      enabledChannels: [],
      probed: false,
      ok: false,
    };
  }

  const known = Object.keys(adapters);
  for (const service of config.services) {
    if (known.includes(service.adapter)) continue;
    findings.push({
      level: "error",
      message: `service "${service.id}" names adapter "${service.adapter}", which does not exist (known: ${known.join(", ")})`,
    });
  }

  const probed = options.probe === true;
  if (probed) findings.push(...(await probeServices(config)));

  return {
    findings,
    services: config.services.length,
    enabledServices: config.services.filter((service) => service.enabled).length,
    enabledChannels: config.channels.filter((channel) => channel.enabled).map((channel) => channel.id),
    probed,
    ok: !findings.some((finding) => finding.level === "error"),
  };
}

/**
 * Asks each enabled provider's page which adapter reads it. A page no adapter
 * recognises is a real misconfiguration — the poller will read nothing from it —
 * while one recognised by a different adapter than the file names is only
 * probably wrong: the html adapter is a legitimate choice for a page that also
 * serves a Statuspage summary.
 *
 * Disabled services are left alone: the file says not to read them.
 */
async function probeServices(config: RuntimeConfig): Promise<CheckFinding[]> {
  const timeoutMs = config.polling.requestTimeoutSeconds * 1000;
  const findings: CheckFinding[] = [];

  for (const service of config.services) {
    if (!service.enabled) continue;
    let detected: Awaited<ReturnType<typeof detectAdapter>>;
    try {
      detected = await detectAdapter(service.baseUrl, { timeoutMs });
    } catch (error) {
      findings.push({
        level: "error",
        message: `service "${service.id}": ${service.baseUrl} could not be probed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      continue;
    }

    if (detected.adapter === null) {
      findings.push({
        level: "error",
        message: `service "${service.id}": no adapter recognises ${service.baseUrl}`,
      });
      continue;
    }
    if (detected.adapter !== service.adapter) {
      findings.push({
        level: "warning",
        message: `service "${service.id}" names adapter "${service.adapter}" but ${service.baseUrl} looks like "${detected.adapter}"${
          detected.baseUrl === null || detected.baseUrl === service.baseUrl ? "" : ` (base url ${detected.baseUrl})`
        }`,
      });
    }
  }

  return findings;
}
