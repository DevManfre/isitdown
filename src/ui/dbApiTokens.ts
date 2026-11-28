import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

/**
 * Named, scoped, revocable API tokens — roadmap 9.11.
 *
 * One `API_TOKEN` in the environment was a door with one key, and every key it
 * could hand out opened the same thing: reads. A CI job that writes deploy
 * annotations, a script that mutes a provider during maintenance, a home page
 * widget — each wants its own key, scoped to what it does, that can be taken
 * back on its own.
 *
 * The token itself is never stored. What the table keeps is its SHA-256: the
 * token is 32 random bytes, so there is nothing for a salt or a slow hash to
 * protect against, and a lookup by hash is one indexed read per request.
 */

/** What a token may do. `admin` implies every other one; the rest are independent. */
export const API_SCOPES = ["read", "annotations:write", "push", "mute", "admin"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** Recognisable in a log someone pasted, or in a secret scanner's rules. */
const TOKEN_PREFIX = "iid_";

/** How often a token's "last used" is written at most: every request would be a write per read. */
export const LAST_USED_RESOLUTION_MS = 60_000;

export const hashToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

export interface ApiTokenRow {
  id: number;
  name: string;
  scopes: ApiScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedApiToken extends ApiTokenRow {
  /** The only time it is ever returned. */
  token: string;
}

export interface ApiTokenStore {
  /** Whether any token is still valid: what turns the gate on with no `API_TOKEN` set. */
  anyActive(): boolean;
  /** The id and scopes of a valid token, or null for an unknown or revoked one. */
  find(token: string): { id: number; scopes: readonly ApiScope[] } | null;
  /** Records a use, at most once per `LAST_USED_RESOLUTION_MS`. */
  touch(id: number): void;
  list(): ApiTokenRow[];
  create(input: { name: string; scopes: readonly ApiScope[] }): CreatedApiToken;
  /** False when there is no such token, or it was already revoked. */
  revoke(id: number): boolean;
}

const scopesSchema = z.array(z.enum(API_SCOPES));

interface Row {
  id: number;
  name: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/**
 * A stored scope list is read through the schema like any other input: a row
 * edited by hand into nonsense grants nothing rather than crashing the gate.
 */
function parseScopes(raw: string): ApiScope[] {
  try {
    const parsed = scopesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

const toRow = (row: Row): ApiTokenRow => ({
  id: row.id,
  name: row.name,
  scopes: parseScopes(row.scopes),
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
  revokedAt: row.revoked_at,
});

export function createApiTokenStore(db: DatabaseSync, now: () => number = Date.now): ApiTokenStore {
  // Last write per token, in memory: the throttle must not itself cost a read.
  const touched = new Map<number, number>();

  return {
    anyActive() {
      return db.prepare("SELECT 1 FROM api_tokens WHERE revoked_at IS NULL LIMIT 1").get() !== undefined;
    },

    find(token) {
      if (!token.startsWith(TOKEN_PREFIX)) return null;
      const row = db
        .prepare("SELECT id, scopes FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL")
        .get(hashToken(token)) as { id: number; scopes: string } | undefined;
      return row === undefined ? null : { id: row.id, scopes: parseScopes(row.scopes) };
    },

    touch(id) {
      const at = now();
      const last = touched.get(id);
      if (last !== undefined && at - last < LAST_USED_RESOLUTION_MS) return;
      touched.set(id, at);
      db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(new Date(at).toISOString(), id);
    },

    list() {
      return (
        db
          .prepare("SELECT id, name, scopes, created_at, last_used_at, revoked_at FROM api_tokens ORDER BY id")
          .all() as unknown as Row[]
      ).map(toRow);
    },

    create({ name, scopes }) {
      const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
      const createdAt = new Date(now()).toISOString();
      // Sorted and de-duplicated, so the list reads the same however it was asked for.
      const stored = API_SCOPES.filter((scope) => scopes.includes(scope));
      const result = db
        .prepare("INSERT INTO api_tokens (name, token_hash, scopes, created_at) VALUES (?, ?, ?, ?)")
        .run(name, hashToken(token), JSON.stringify(stored), createdAt);
      return {
        id: Number(result.lastInsertRowid),
        name,
        scopes: stored,
        createdAt,
        lastUsedAt: null,
        revokedAt: null,
        token,
      };
    },

    revoke(id) {
      const result = db
        .prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
        .run(new Date(now()).toISOString(), id);
      touched.delete(id);
      return Number(result.changes) > 0;
    },
  };
}
