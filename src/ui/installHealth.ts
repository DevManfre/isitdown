import type { DatabaseSync } from "node:sqlite";

/**
 * Roadmap 5.15 and 5.16: what the installation itself would like the operator
 * to look at — providers that seem to have been forgotten, and a checklist of
 * the housekeeping nobody does until it matters.
 *
 * Nothing here acts: both answers are read from state the dashboard already
 * keeps, plus two timestamps it did not (a channel test and a backup leave no
 * trace anywhere else), and the dashboard turns them into suggestions.
 */

/** A provider off, or a probe failing, for this long reads as abandoned. */
export const ABANDONED_AFTER_DAYS = 30;
/** A channel nobody has tested for this long may have lost its credential unnoticed. */
export const STALE_TEST_DAYS = 90;
/** `retentionDays`' own floor (the settings schema) — "at the minimum" is this. */
const MINIMUM_RETENTION_DAYS = 7;

const DAY_MS = 86_400_000;

export interface AbandonedProvider {
  id: string;
  name: string;
  /** Switched off for the window, or enabled but never read successfully in it. */
  reason: "disabled" | "failing";
  /** When it was switched off, or when it was last read successfully. */
  since: string;
}

/**
 * Both signals need evidence rather than absence of it. A disabled provider
 * counts from the audit trail's record of the switch, so one whose history was
 * pruned or that was never touched through the dashboard is not guessed at; a
 * failing one needs samples that reach back past the window, so a provider
 * added last week and already unreachable is not "abandoned", just new.
 */
export function abandonedProviders(db: DatabaseSync, nowMs: number): AbandonedProvider[] {
  const cutoff = new Date(nowMs - ABANDONED_AFTER_DAYS * DAY_MS).toISOString();
  const services = db
    .prepare("SELECT id, name, enabled FROM services WHERE deleted_at IS NULL ORDER BY name")
    .all() as { id: string; name: string; enabled: number }[];

  const found: AbandonedProvider[] = [];
  for (const service of services) {
    if (service.enabled === 0) {
      const switched = db
        .prepare(
          "SELECT at FROM config_audit WHERE kind = 'service' AND target = ? AND field = 'enabled' AND after = 'false' ORDER BY at DESC, id DESC LIMIT 1",
        )
        .get(service.id) as { at: string } | undefined;
      if (switched !== undefined && switched.at <= cutoff) {
        found.push({ id: service.id, name: service.name, reason: "disabled", since: switched.at });
      }
      continue;
    }
    const span = db
      .prepare(
        "SELECT MIN(observed_at) AS first, MAX(CASE WHEN ok = 1 THEN observed_at END) AS lastOk FROM status_samples WHERE provider_id = ?",
      )
      .get(service.id) as { first: string | null; lastOk: string | null };
    if (span.first === null || span.first > cutoff) continue;
    if (span.lastOk !== null && span.lastOk > cutoff) continue;
    found.push({ id: service.id, name: service.name, reason: "failing", since: span.lastOk ?? span.first });
  }
  return found;
}

export type InstallEvent = "channelTest" | "backup";

const EVENT_KEYS: Record<InstallEvent, string> = {
  channelTest: "lastChannelTestAt",
  backup: "lastBackupAt",
};

/**
 * Stored as two `settings` rows outside the settings schema, the same way the
 * VAPID pair is: they describe this installation, not a choice the operator
 * made, so they have no field on the Settings page and no audit entry.
 */
export function noteInstallEvent(db: DatabaseSync, event: InstallEvent, at: Date = new Date()): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  ).run(EVENT_KEYS[event], at.toISOString());
}

function readInstallEvent(db: DatabaseSync, event: InstallEvent): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(EVENT_KEYS[event]) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export type CheckState = "ok" | "warn" | "unknown";

export interface InstallCheck {
  id: "channels" | "channel-test" | "backup" | "retention" | "version" | "token";
  state: CheckState;
  /** Where the operator fixes it: a dashboard route, or an https link to the manual. */
  fix: string;
  /** Interpolated into the row's sentence; only the checks that have a number carry one. */
  days?: number;
}

export interface InstallFacts {
  enabledChannels: number;
  retentionDays: number;
  update: "unknown" | "current" | "available" | "failed";
  publicPageEnabled: boolean;
  apiTokenSet: boolean;
}

const TOKEN_MANUAL =
  "https://github.com/DevManfre/isitdown/blob/main/docs/configuration.md#312-reaching-the-api-from-another-host";

export function installChecks(db: DatabaseSync, facts: InstallFacts, nowMs: number): InstallCheck[] {
  const tested = readInstallEvent(db, "channelTest");
  const testAge = tested === null ? null : Math.floor((nowMs - Date.parse(tested)) / DAY_MS);
  const testStale = testAge === null || testAge >= STALE_TEST_DAYS;

  return [
    {
      id: "channels",
      state: facts.enabledChannels > 0 ? "ok" : "warn",
      fix: "/settings/notifications",
    },
    {
      id: "channel-test",
      // With no channel there is nothing to test; the row above already says so.
      state: facts.enabledChannels === 0 || !testStale ? "ok" : "warn",
      fix: "/settings/notifications",
      ...(testAge === null ? {} : { days: testAge }),
    },
    {
      id: "backup",
      state: readInstallEvent(db, "backup") === null ? "warn" : "ok",
      fix: "/settings/data",
    },
    {
      id: "retention",
      state: facts.retentionDays <= MINIMUM_RETENTION_DAYS ? "warn" : "ok",
      fix: "/settings/data",
    },
    {
      id: "version",
      // An update check that is off, or has not answered, proves nothing
      // either way — so it is neither a pass nor a warning.
      state: facts.update === "available" ? "warn" : facts.update === "current" ? "ok" : "unknown",
      fix: "/settings/data",
    },
    {
      id: "token",
      state: facts.publicPageEnabled && !facts.apiTokenSet ? "warn" : "ok",
      fix: TOKEN_MANUAL,
    },
  ];
}
