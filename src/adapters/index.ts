import type { Adapter } from "../core/adapter.interface.ts";
import { awsAdapter } from "./aws.adapter.ts";
import { azureAdapter } from "./azure.adapter.ts";
import { betterStackAdapter } from "./betterstack.adapter.ts";
import { cachetAdapter } from "./cachet.adapter.ts";
import { gcpAdapter } from "./gcp.adapter.ts";
import { htmlAdapter } from "./html.adapter.ts";
import { httpAdapter } from "./http.adapter.ts";
import { instatusAdapter } from "./instatus.adapter.ts";
import { rssAdapter } from "./rss.adapter.ts";
import { slackAdapter } from "./slack.adapter.ts";
import { statuspageAdapter } from "./statuspage.adapter.ts";
import { uptimeComAdapter } from "./uptimecom.adapter.ts";
import { uptimeKumaAdapter } from "./uptimekuma.adapter.ts";

export const adapters: Record<string, Adapter> = {
  [statuspageAdapter.id]: statuspageAdapter,
  [rssAdapter.id]: rssAdapter,
  [slackAdapter.id]: slackAdapter,
  [awsAdapter.id]: awsAdapter,
  [gcpAdapter.id]: gcpAdapter,
  [azureAdapter.id]: azureAdapter,
  [instatusAdapter.id]: instatusAdapter,
  [betterStackAdapter.id]: betterStackAdapter,
  [cachetAdapter.id]: cachetAdapter,
  [uptimeKumaAdapter.id]: uptimeKumaAdapter,
  [uptimeComAdapter.id]: uptimeComAdapter,
  [htmlAdapter.id]: htmlAdapter,
  [httpAdapter.id]: httpAdapter,
};

export function getAdapter(id: string): Adapter {
  const adapter = adapters[id];
  if (adapter === undefined) {
    throw new Error(`unknown adapter: ${id} (known: ${Object.keys(adapters).join(", ")})`);
  }
  return adapter;
}
