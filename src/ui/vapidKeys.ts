import type { DatabaseSync } from "node:sqlite";
import webpush from "web-push";
import type { Logger } from "../core/logger.ts";

/**
 * The VAPID pair the webpush channel signs with. Unlike a bot token or a
 * webhook URL it is not an operator credential handed to us from outside: it is
 * this server's own identity towards the push services, meaningless anywhere
 * else and regenerable at will. So it is generated on first use and kept in
 * SQLite next to the subscriptions it belongs to, rather than asked of the
 * operator through two environment variables that only existed to be pasted in
 * once — enabling the channel and pressing "enable on this browser" is now the
 * whole setup.
 *
 * The private half never leaves the process: `GET /config/push` hands back the
 * public half only, which is public by construction (the browser needs it to
 * subscribe at all).
 */

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

const PUBLIC_KEY = "vapidPublicKey";
const PRIVATE_KEY = "vapidPrivateKey";

/**
 * A VAPID public key is an uncompressed P-256 point: base64url-decode it and it
 * must be exactly 65 bytes starting with 0x04. Anything else in the row is not
 * a key a browser could ever subscribe with — a hand-edited database, a
 * truncated copy-paste — so it is replaced rather than served, which is also
 * why a length/character-set regex is not enough here.
 */
export function isVapidPublicKey(value: string): boolean {
  if (value === "") return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 65 && bytes[0] === 0x04;
}

const read = (db: DatabaseSync, key: string): string => {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value?: string } | undefined;
  return row?.value ?? "";
};

/**
 * Returns the stored pair, generating and persisting one the first time (or
 * whenever what is stored could not work). Regenerating invalidates every
 * subscription made with the old key, so it is logged rather than done quietly.
 */
export function ensureVapidKeys(db: DatabaseSync, logger?: Logger): VapidKeys {
  const publicKey = read(db, PUBLIC_KEY);
  const privateKey = read(db, PRIVATE_KEY);
  if (isVapidPublicKey(publicKey) && privateKey !== "") return { publicKey, privateKey };

  if (publicKey !== "" || privateKey !== "") {
    logger?.warn("the stored VAPID key pair is unusable and is being replaced", { publicKey });
  }
  const generated = webpush.generateVAPIDKeys();
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  upsert.run(PUBLIC_KEY, generated.publicKey);
  upsert.run(PRIVATE_KEY, generated.privateKey);
  return { publicKey: generated.publicKey, privateKey: generated.privateKey };
}
