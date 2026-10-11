import type { DatabaseSync } from "node:sqlite";
import { adapters } from "../adapters/index.ts";
import { CATALOG, CATALOG_GENERATED_AT, catalogFileSchema, type CatalogEntry } from "../adapters/catalog.ts";
import {
  CATALOG_FEED_URL,
  CATALOG_SIGNATURE_URL,
  catalogProposals,
  dismissalKey,
  isNewer,
  verifyCatalog,
  type CatalogProposal,
} from "../adapters/catalogFeed.ts";
import { USER_AGENT } from "../core/http.ts";
import type { Logger } from "../core/logger.ts";
import { listServices } from "./dbConfigSource.ts";

/**
 * The UI edition's half of roadmap 2.2: reading the signed catalog on a slow
 * cadence, remembering the last good copy across restarts, and remembering
 * which proposals the operator turned down.
 *
 * Off by default, like the update check beside it in Settings, and for the
 * same reason: it is a request to a host this install did not choose to
 * monitor. With the switch off nothing is fetched and the bundled list is the
 * catalog, byte for byte what it was before this existed.
 */

/** Edits to a status page's address are rare; once a day finds them soon enough. */
export const CATALOG_CHECK_INTERVAL_MS = 24 * 3600 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const STORED = "catalogFeed";
const DISMISSED = "catalogFeedDismissed";

export type CatalogFeedStatus = "unknown" | "current" | "updated" | "failed";

export interface CatalogFeedState {
  status: CatalogFeedStatus;
  /** Which list the picker and the proposals read: the image's own, or the downloaded one. */
  source: "bundled" | "remote";
  generatedAt: string;
  entries: number;
  checkedAt: string | null;
  /** Why the last check did not take, when it did not. */
  reason?: string | undefined;
}

export interface CatalogFeed {
  state(): CatalogFeedState;
  /** The catalog in force: the downloaded one when it verified and is newer, the bundled one otherwise. */
  entries(): readonly CatalogEntry[];
  /** Fetches now if `enabled` and the last check is older than a day (or `force`). */
  maybeRun(enabled: boolean, options?: { force?: boolean }): Promise<void>;
  proposals(): CatalogProposal[];
  dismiss(serviceId: string): boolean;
}

export interface CatalogFeedDeps {
  db: DatabaseSync;
  logger: Logger;
  fetch?: typeof fetch | undefined;
  now?: (() => Date) | undefined;
  /** The key signatures are checked against; tests pass their own. */
  publicKey?: string | undefined;
}

export function createCatalogFeed(deps: CatalogFeedDeps): CatalogFeed {
  const { db, logger } = deps;
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  const read = (key: string): string | undefined =>
    (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value?: string } | undefined)?.value;
  const write = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );

  /** The last verified download, re-checked on boot so a stored copy is never trusted more than a fresh one. */
  function storedCatalog(): CatalogEntry[] | null {
    const raw = read(STORED);
    if (raw === undefined) return null;
    try {
      const parsed = catalogFileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success || !isNewer(parsed.data, CATALOG_GENERATED_AT)) return null;
      remoteGeneratedAt = parsed.data.generatedAt;
      return parsed.data.entries;
    } catch {
      return null;
    }
  }

  let remoteGeneratedAt: string | null = null;
  let remote: CatalogEntry[] | null = storedCatalog();
  let status: CatalogFeedStatus = "unknown";
  let checkedAt: string | null = null;
  let reason: string | undefined;

  function dismissed(): Set<string> {
    try {
      const parsed: unknown = JSON.parse(read(DISMISSED) ?? "[]");
      return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
    } catch {
      return new Set();
    }
  }

  async function check(): Promise<void> {
    checkedAt = now().toISOString();
    try {
      const get = async (url: string): Promise<string> => {
        const response = await doFetch(url, {
          headers: { "user-agent": USER_AGENT },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
        return response.text();
      };
      const [body, signature] = await Promise.all([get(CATALOG_FEED_URL), get(CATALOG_SIGNATURE_URL)]);
      const verified = verifyCatalog(body, signature, Object.keys(adapters), deps.publicKey);
      if (!verified.ok) throw new Error(verified.reason);
      if (verified.dropped.length > 0) {
        logger.info("the downloaded catalog names providers this build cannot read; they are left out", {
          providers: verified.dropped,
        });
      }
      if (!isNewer(verified.catalog, CATALOG_GENERATED_AT)) {
        status = "current";
        reason = undefined;
        return;
      }
      write.run(STORED, JSON.stringify(verified.catalog));
      const changed = remoteGeneratedAt !== verified.catalog.generatedAt;
      remote = verified.catalog.entries;
      remoteGeneratedAt = verified.catalog.generatedAt;
      status = "updated";
      reason = undefined;
      if (changed) {
        logger.info("a newer provider catalog was downloaded", {
          generatedAt: verified.catalog.generatedAt,
          entries: verified.catalog.entries.length,
        });
      }
    } catch (error) {
      // Quiet, like the update check: an opt-in background read that cannot
      // reach GitHub must not show up as an error anywhere. The last good copy
      // — or the bundled one — stays in charge.
      status = "failed";
      reason = error instanceof Error ? error.message : String(error);
      logger.debug("catalog check failed", { error: reason });
    }
  }

  return {
    state() {
      return {
        status,
        source: remote === null ? "bundled" : "remote",
        generatedAt: remoteGeneratedAt ?? CATALOG_GENERATED_AT,
        entries: (remote ?? CATALOG).length,
        checkedAt,
        ...(reason === undefined ? {} : { reason }),
      };
    },

    entries() {
      return remote ?? CATALOG;
    },

    async maybeRun(enabled, options = {}) {
      if (!enabled) return;
      const last = checkedAt === null ? null : Date.parse(checkedAt);
      if (options.force !== true && last !== null && now().getTime() - last < CATALOG_CHECK_INTERVAL_MS) return;
      await check();
    },

    proposals() {
      // Only from a downloaded list: the bundled one is what the provider was
      // added from, so a difference against it is the operator's own edit.
      if (remote === null) return [];
      return catalogProposals(listServices(db), remote, dismissed());
    },

    dismiss(serviceId) {
      const proposal = this.proposals().find((candidate) => candidate.serviceId === serviceId);
      if (proposal === undefined) return false;
      const next = dismissed();
      next.add(dismissalKey(serviceId, proposal.to));
      write.run(DISMISSED, JSON.stringify([...next]));
      return true;
    },
  };
}
