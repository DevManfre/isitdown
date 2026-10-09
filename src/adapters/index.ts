import type { Adapter } from "../core/adapter.interface.ts";
import { authProblems } from "../core/requestAuth.ts";
import { awsAdapter } from "./aws.adapter.ts";
import { azureAdapter } from "./azure.adapter.ts";
import { betterStackAdapter } from "./betterstack.adapter.ts";
import { cachetAdapter } from "./cachet.adapter.ts";
import { dnsAdapter } from "./dns.adapter.ts";
import { gcpAdapter } from "./gcp.adapter.ts";
import { htmlAdapter } from "./html.adapter.ts";
import { imapAdapter } from "./imap.adapter.ts";
import { httpAdapter } from "./http.adapter.ts";
import { instatusAdapter } from "./instatus.adapter.ts";
import { jsonAdapter } from "./json.adapter.ts";
import { rssAdapter } from "./rss.adapter.ts";
import { slackAdapter } from "./slack.adapter.ts";
import { statuspageAdapter } from "./statuspage.adapter.ts";
import { tcpAdapter } from "./tcp.adapter.ts";
import { uptimeComAdapter } from "./uptimecom.adapter.ts";
import { uptimeKumaAdapter } from "./uptimekuma.adapter.ts";
import { watchdogAdapter } from "./watchdog.adapter.ts";

/**
 * The adapters this build ships with. A plugin may add to this at boot
 * (roadmap 1.13) but may never replace an entry — see `registerAdapter`.
 */
export const adapters: Record<string, Adapter> = {
  [statuspageAdapter.id]: statuspageAdapter,
  [rssAdapter.id]: rssAdapter,
  [slackAdapter.id]: slackAdapter,
  [awsAdapter.id]: awsAdapter,
  [gcpAdapter.id]: gcpAdapter,
  [azureAdapter.id]: azureAdapter,
  [instatusAdapter.id]: instatusAdapter,
  [jsonAdapter.id]: jsonAdapter,
  [betterStackAdapter.id]: betterStackAdapter,
  [cachetAdapter.id]: cachetAdapter,
  [uptimeKumaAdapter.id]: uptimeKumaAdapter,
  [uptimeComAdapter.id]: uptimeComAdapter,
  [htmlAdapter.id]: htmlAdapter,
  [watchdogAdapter.id]: watchdogAdapter,
  [imapAdapter.id]: imapAdapter,
  [httpAdapter.id]: httpAdapter,
  [tcpAdapter.id]: tcpAdapter,
  [dnsAdapter.id]: dnsAdapter,
};

/**
 * Adds an adapter the build did not ship with — the one thing a plugin does
 * (roadmap 1.13).
 *
 * Refuses an id that already exists, and says so rather than returning false:
 * a plugin quietly taking `statuspage` would change what every existing
 * provider reads, and the caller's job is to report that file as unusable, not
 * to carry on with a fleet that now behaves differently for reasons nothing on
 * screen explains.
 */
export function registerAdapter(adapter: Adapter): void {
  if (adapters[adapter.id] !== undefined) {
    throw new Error(
      `an adapter with the id "${adapter.id}" is already registered`,
    );
  }
  adapters[adapter.id] = adapter;
}

/**
 * Why a provider's options cannot work under this adapter, one sentence each —
 * roadmap 11.1. Empty when they can, and empty for an unknown adapter, whose
 * own error the caller reports separately.
 */
export function optionProblems(
  adapter: string,
  options: Record<string, string> | undefined,
): string[] {
  const own = adapters[adapter]?.validateOptions?.(options) ?? [];
  return AUTHENTICATED_READERS.has(adapter) ? [...own, ...authProblems(options)] : own;
}

/**
 * Why a provider's cadence cannot work, one sentence each — roadmap 1.6. A
 * cadence in seconds is for a probe: a status page read every ten seconds says
 * nothing it did not say a minute ago, and costs its owner six requests for
 * it. Empty for an unknown adapter, like `optionProblems`.
 */
export function cadenceProblems(service: {
  adapter: string;
  intervalMinutes?: number | null | undefined;
  intervalSeconds?: number | null | undefined;
}): string[] {
  if (service.intervalSeconds === undefined || service.intervalSeconds === null) return [];
  const problems: string[] = [];
  const adapter = adapters[service.adapter];
  if (adapter !== undefined && adapter.kind !== "probe") {
    problems.push(
      `intervalSeconds is only for a probe (http, tcp, dns); the ${service.adapter} adapter reads a status page, use intervalMinutes`,
    );
  }
  if (service.intervalMinutes !== undefined && service.intervalMinutes !== null) {
    problems.push("intervalSeconds and intervalMinutes cannot both be set");
  }
  return problems;
}

/**
 * The adapters whose reads go through `fetchConditional`, and so carry a
 * provider's credentials (roadmap 1.5). Not the probes, which have their own
 * `header.<Name>`, and not `imap`, which logs in rather than sending a header.
 */
const AUTHENTICATED_READERS = new Set([
  statuspageAdapter.id,
  rssAdapter.id,
  slackAdapter.id,
  awsAdapter.id,
  gcpAdapter.id,
  azureAdapter.id,
  htmlAdapter.id,
  watchdogAdapter.id,
  jsonAdapter.id,
  instatusAdapter.id,
  betterStackAdapter.id,
  cachetAdapter.id,
  uptimeKumaAdapter.id,
  uptimeComAdapter.id,
]);

export function getAdapter(id: string): Adapter {
  const adapter = adapters[id];
  if (adapter === undefined) {
    throw new Error(
      `unknown adapter: ${id} (known: ${Object.keys(adapters).join(", ")})`,
    );
  }
  return adapter;
}
