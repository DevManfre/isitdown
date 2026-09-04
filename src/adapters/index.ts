import type { Adapter } from "../core/adapter.interface.ts";
import { rssAdapter } from "./rss.adapter.ts";
import { slackAdapter } from "./slack.adapter.ts";
import { statuspageAdapter } from "./statuspage.adapter.ts";

export const adapters: Record<string, Adapter> = {
  [statuspageAdapter.id]: statuspageAdapter,
  [rssAdapter.id]: rssAdapter,
  [slackAdapter.id]: slackAdapter,
};

export function getAdapter(id: string): Adapter {
  const adapter = adapters[id];
  if (adapter === undefined) {
    throw new Error(`unknown adapter: ${id} (known: ${Object.keys(adapters).join(", ")})`);
  }
  return adapter;
}
