import type { Adapter } from "../core/adapter.interface.ts";
import { statuspageAdapter } from "./statuspage.adapter.ts";

export const adapters: Record<string, Adapter> = {
  [statuspageAdapter.id]: statuspageAdapter,
};

export function getAdapter(id: string): Adapter {
  const adapter = adapters[id];
  if (adapter === undefined) {
    throw new Error(`unknown adapter: ${id} (known: ${Object.keys(adapters).join(", ")})`);
  }
  return adapter;
}
