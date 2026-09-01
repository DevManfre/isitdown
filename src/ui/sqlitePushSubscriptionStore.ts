import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { PushSubscription, PushSubscriptionStore } from "../core/pushSubscriptionStore.interface.ts";

function idFor(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

export interface PushDevice {
  id: string;
  label: string;
  createdAt: string;
}

export interface SqlitePushSubscriptionStore extends PushSubscriptionStore {
  save(subscription: PushSubscription, label: string): void;
  listDevices(): PushDevice[];
  remove(id: string): boolean;
}

/**
 * Rows come back from SQLite untyped, same reasoning as sqliteStateStore:
 * validating rather than casting means schema drift shows up as a clear
 * error instead of an `undefined` three layers away.
 */
const deviceRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  createdAt: z.string(),
});

const subscriptionRowSchema = z.object({
  endpoint: z.string(),
  p256dh: z.string(),
  auth: z.string(),
});

/**
 * The device list behind the `webpush` channel. Reads are synchronous like
 * the rest of the UI edition's SQLite access; the async surface exists
 * because the core interface was written so stores may not be local.
 */
export function createSqlitePushSubscriptionStore(db: DatabaseSync): SqlitePushSubscriptionStore {
  return {
    save(subscription: PushSubscription, label: string): void {
      db.prepare(
        `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, label, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label`,
      ).run(
        idFor(subscription.endpoint),
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        label,
        new Date().toISOString(),
      );
    },

    listDevices(): PushDevice[] {
      return db
        .prepare("SELECT id, label, created_at AS createdAt FROM push_subscriptions ORDER BY created_at, id")
        .all()
        .map((raw) => deviceRowSchema.parse(raw));
    },

    remove(id: string): boolean {
      const result = db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(id);
      return Number(result.changes) > 0;
    },

    async list(): Promise<PushSubscription[]> {
      const rows = db
        .prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions ORDER BY created_at, id")
        .all()
        .map((raw) => subscriptionRowSchema.parse(raw));
      return rows.map((row) => ({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }));
    },

    async prune(endpoint: string): Promise<void> {
      db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
    },
  };
}
