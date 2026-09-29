import { z } from "zod";
import { USER_AGENT } from "../core/http.ts";
import type { Logger } from "../core/logger.ts";
import pkg from "../../package.json" with { type: "json" };

/**
 * Roadmap 15.11a: an opt-in, quiet "is a newer version out" check, off by
 * default. It reads GHCR's public tag list for this project's UI image once a
 * day and compares the highest `ui-v<semver>` tag against the version this
 * process was built at — nothing else leaves the machine, and nothing here
 * ever writes or installs anything.
 *
 * `pkg.version` — not an environment variable or a build-time constant — so
 * the comparison always matches the code actually running.
 */
export const CURRENT_VERSION: string = pkg.version;

const GHCR_REPOSITORY = "devmanfre/isitdown";
const TAG_PREFIX = "ui-v";
const REQUEST_TIMEOUT_MS = 8_000;

/** How long a check's result is trusted before the next one is worth making. */
export const CHECK_INTERVAL_MS = 24 * 3600 * 1000;

const tokenResponseSchema = z.object({ token: z.string().min(1) });
const tagsResponseSchema = z.object({ tags: z.array(z.string()).default([]) });

export type UpdateCheckStatus = "unknown" | "current" | "available" | "failed";

export interface UpdateCheckState {
  status: UpdateCheckStatus;
  currentVersion: string;
  /** The newest `ui-v<semver>` tag's version, only set when `status` is `"available"`. */
  latestVersion: string | null;
  checkedAt: string | null;
}

export const INITIAL_UPDATE_CHECK_STATE: UpdateCheckState = {
  status: "unknown",
  currentVersion: CURRENT_VERSION,
  latestVersion: null,
  checkedAt: null,
};

type SemverTriple = readonly [number, number, number];

/**
 * Only `ui-v<major>.<minor>.<patch>` tags name a comparable release — `ui-latest`,
 * `latest` and anything without that prefix are not semver and are ignored,
 * exactly as roadmap 15.11a's scope asks.
 */
function parseSemverTag(tag: string): SemverTriple | null {
  const match = /^ui-v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (match === null) return null;
  const [, major, minor, patch] = match;
  if (major === undefined || minor === undefined || patch === undefined) return null;
  return [Number(major), Number(minor), Number(patch)];
}

function compareSemver(a: SemverTriple, b: SemverTriple): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export interface CheckForUpdateOptions {
  fetch: typeof fetch;
  currentVersion: string;
  logger: Logger;
}

/**
 * One read of GHCR's public tag list for this image, compared against the
 * running version. Two anonymous, unauthenticated requests — a registry token
 * and the tag list itself — carrying nothing about this instance: no current
 * version in the query or headers, no instance id, no provider count. Any
 * failure (network, timeout, an answer that does not parse) resolves to
 * `"failed"` rather than throwing, so a background check can never surface an
 * error or stop the app.
 */
export async function checkForUpdate(options: CheckForUpdateOptions): Promise<UpdateCheckState> {
  const checkedAt = new Date().toISOString();
  const currentVersion = options.currentVersion;
  try {
    const tokenResponse = await options.fetch(
      `https://ghcr.io/token?service=ghcr.io&scope=repository:${GHCR_REPOSITORY}:pull`,
      {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!tokenResponse.ok) {
      throw new Error(`ghcr token request failed: HTTP ${tokenResponse.status}`);
    }
    const { token } = tokenResponseSchema.parse(await tokenResponse.json());

    const tagsResponse = await options.fetch(`https://ghcr.io/v2/${GHCR_REPOSITORY}/tags/list`, {
      headers: { authorization: `Bearer ${token}`, "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!tagsResponse.ok) {
      throw new Error(`ghcr tags request failed: HTTP ${tagsResponse.status}`);
    }
    const { tags } = tagsResponseSchema.parse(await tagsResponse.json());

    const current = parseSemverTag(`${TAG_PREFIX}${currentVersion}`);
    if (current === null) throw new Error(`running version is not semver: ${currentVersion}`);

    let highest = current;
    let highestTag: string | null = null;
    for (const tag of tags) {
      const parsed = parseSemverTag(tag);
      if (parsed === null) continue;
      if (compareSemver(parsed, highest) > 0) {
        highest = parsed;
        highestTag = tag;
      }
    }

    return {
      status: highestTag === null ? "current" : "available",
      currentVersion,
      latestVersion: highestTag === null ? null : highestTag.slice(TAG_PREFIX.length),
      checkedAt,
    };
  } catch (error) {
    // Silent by design (roadmap 15.11a): a background, opt-in check that
    // cannot reach GHCR or gets back something unexpected must not surface an
    // error anywhere in the dashboard, so this stays a debug log.
    options.logger.debug("update check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: "failed", currentVersion, latestVersion: null, checkedAt };
  }
}

export interface UpdateChecker {
  /** The last result — `"unknown"` until the first run, whether or not the option is on. */
  state(): UpdateCheckState;
  /**
   * Runs a check now if `enabled` and the last one (if any, this process) is
   * older than {@link CHECK_INTERVAL_MS}. Reads nothing from GHCR when
   * `enabled` is false — the caller passes the current setting on every call,
   * so a toggle flipped from the dashboard takes effect on the next run
   * without a restart, exactly like `prune`'s `retentionDays`.
   */
  maybeRun(enabled: boolean): Promise<void>;
}

/**
 * No persistence across restarts: there is no existing joint in this edition
 * for "when did we last check GHCR", and roadmap 15.11a is explicit that one
 * should not be invented for this alone. A boot-time run plus this daily gate
 * keeps every *running* process to at most one check a day, which is what the
 * roadmap asks for.
 */
export function createUpdateChecker(options: {
  logger: Logger;
  currentVersion?: string;
  fetchImpl?: typeof fetch;
}): UpdateChecker {
  const currentVersion = options.currentVersion ?? CURRENT_VERSION;
  const fetchImpl = options.fetchImpl ?? fetch;
  let last: UpdateCheckState = { ...INITIAL_UPDATE_CHECK_STATE, currentVersion };
  let lastRunAtMs: number | undefined;

  return {
    state: () => last,
    async maybeRun(enabled: boolean): Promise<void> {
      if (!enabled) return;
      const now = Date.now();
      if (lastRunAtMs !== undefined && now - lastRunAtMs < CHECK_INTERVAL_MS) return;
      lastRunAtMs = now;
      last = await checkForUpdate({ fetch: fetchImpl, currentVersion, logger: options.logger });
    },
  };
}
