import type { Adapter } from "../core/adapter.interface.ts";
import { awsAdapter } from "./aws.adapter.ts";
import { azureAdapter } from "./azure.adapter.ts";
import { betterStackAdapter } from "./betterstack.adapter.ts";
import { cachetAdapter } from "./cachet.adapter.ts";
import { dnsAdapter } from "./dns.adapter.ts";
import { gcpAdapter } from "./gcp.adapter.ts";
import { htmlAdapter } from "./html.adapter.ts";
import { httpAdapter } from "./http.adapter.ts";
import { instatusAdapter } from "./instatus.adapter.ts";
import { jsonAdapter } from "./json.adapter.ts";
import { rssAdapter } from "./rss.adapter.ts";
import { slackAdapter } from "./slack.adapter.ts";
import { statuspageAdapter } from "./statuspage.adapter.ts";
import { tcpAdapter } from "./tcp.adapter.ts";
import { uptimeComAdapter } from "./uptimecom.adapter.ts";
import { uptimeKumaAdapter } from "./uptimekuma.adapter.ts";

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
  return adapters[adapter]?.validateOptions?.(options) ?? [];
}

export function getAdapter(id: string): Adapter {
  const adapter = adapters[id];
  if (adapter === undefined) {
    throw new Error(
      `unknown adapter: ${id} (known: ${Object.keys(adapters).join(", ")})`,
    );
  }
  return adapter;
}
