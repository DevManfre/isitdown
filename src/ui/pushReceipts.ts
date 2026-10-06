import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

/**
 * When each provider's push webhook last reached us — roadmap 1.2.
 *
 * The receipt is written for every authenticated, well-formed post, a
 * coalesced one included: what it proves is that the provider's subscription
 * points here and carries the right token, which a post inside the cooldown
 * proves exactly as well as the one that triggered the read.
 */
export interface PushReceipt {
  providerId: string;
  receivedAt: string;
  /** Posts received since the provider was added — a single one may be a test. */
  count: number;
}

export interface PushReceipts {
  record(providerId: string, at: string): void;
  list(): PushReceipt[];
}

const rowSchema = z.object({
  provider_id: z.string(),
  received_at: z.string(),
  count: z.number(),
});

export function createPushReceipts(db: DatabaseSync): PushReceipts {
  const upsert = db.prepare(`
    INSERT INTO push_receipts (provider_id, received_at, count) VALUES (?, ?, 1)
    ON CONFLICT (provider_id) DO UPDATE SET received_at = excluded.received_at, count = count + 1
  `);
  const select = db.prepare("SELECT provider_id, received_at, count FROM push_receipts");
  return {
    record(providerId, at) {
      upsert.run(providerId, at);
    },
    list() {
      return select.all().map((raw) => {
        const row = rowSchema.parse(raw);
        return { providerId: row.provider_id, receivedAt: row.received_at, count: row.count };
      });
    },
  };
}
