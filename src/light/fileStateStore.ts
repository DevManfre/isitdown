import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { providerRuntimeStateSchema } from "../core/status.schema.ts";
import type { MessageRefStore } from "../core/messageRefStore.interface.ts";
import type { ProviderRuntimeState, StateStore } from "../core/stateStore.interface.ts";
import type { DampingState, NormalizedStatus } from "../core/types.ts";

const FORMAT_VERSION = 1;

const fileSchema = z.object({
  version: z.literal(FORMAT_VERSION),
  providers: z.record(providerRuntimeStateSchema),
  /**
   * Message ids per channel and incident (roadmap 3.19), keyed by a serialised
   * triple. Defaulted rather than versioned: a file written before message
   * editing existed simply has none, and a version bump would have made an
   * upgrade fatal for a feature that is off by default.
   */
  messageRefs: z.record(z.string()).default({}),
});

const baseline = (): ProviderRuntimeState => ({
  last: null,
  failureCount: 0,
  degradedNotified: false,
  notifyBaseline: null,
  pending: null,
});

/**
 * The Light edition's state store: one JSON file, kept in memory and rewritten
 * on every mutation via a temporary file plus a rename, so a crash mid-write
 * cannot leave a truncated file behind.
 *
 * A file that fails validation is fatal rather than silently reset: starting
 * from an empty store would make the next cycle re-notify every provider, which
 * is exactly the alert burst the design exists to prevent.
 */
export async function createFileStateStore(path: string): Promise<StateStore & MessageRefStore> {
  const file = await readState(path);
  const providers = new Map<string, ProviderRuntimeState>(Object.entries(file.providers));
  const messageRefs = new Map<string, string>(Object.entries(file.messageRefs));

  /** One key from the triple, serialised so an incident id containing anything is safe. */
  const refKey = (channel: string, providerId: string, incidentId: string): string =>
    JSON.stringify([channel, providerId, incidentId]);

  // A cycle polls every provider concurrently, so several mutations land at once.
  // Writes are serialised and each uses its own temporary file: sharing one
  // temporary name let two concurrent renames race, and the loser failed with
  // ENOENT after the winner had already moved the file into place.
  let writes = 0;
  let tail: Promise<unknown> = Promise.resolve();

  async function writeOnce(): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const payload = JSON.stringify(
      {
        version: FORMAT_VERSION,
        providers: Object.fromEntries(providers),
        messageRefs: Object.fromEntries(messageRefs),
      },
      null,
      2,
    );
    writes += 1;
    const temporary = join(dirname(path), `.state.${process.pid}.${writes}.tmp`);
    await writeFile(temporary, `${payload}\n`, "utf8");
    await rename(temporary, path);
  }

  function persist(): Promise<void> {
    const run = tail.then(writeOnce, writeOnce);
    // Keep the chain alive after a failed write while still surfacing the error
    // to the caller that triggered it.
    tail = run.catch(() => undefined);
    return run;
  }

  function stateOf(providerId: string): ProviderRuntimeState {
    const existing = providers.get(providerId);
    if (existing !== undefined) return existing;
    const created = baseline();
    providers.set(providerId, created);
    return created;
  }

  return {
    async getState(providerId: string): Promise<ProviderRuntimeState> {
      return structuredClone(providers.get(providerId) ?? baseline());
    },

    async saveStatus(status: NormalizedStatus): Promise<void> {
      stateOf(status.provider).last = status;
      await persist();
    },

    async recordFailure(providerId: string): Promise<number> {
      const state = stateOf(providerId);
      state.failureCount += 1;
      await persist();
      return state.failureCount;
    },

    async clearFailures(providerId: string): Promise<void> {
      stateOf(providerId).failureCount = 0;
      await persist();
    },

    async setDegradedNotified(providerId: string, value: boolean): Promise<void> {
      stateOf(providerId).degradedNotified = value;
      await persist();
    },

    async saveNotifyState(
      providerId: string,
      notifyBaseline: NormalizedStatus | null,
      pending: DampingState | null,
    ): Promise<void> {
      const state = stateOf(providerId);
      state.notifyBaseline = notifyBaseline;
      state.pending = pending;
      await persist();
    },

    async getRef(channel: string, providerId: string, incidentId: string): Promise<string | null> {
      return messageRefs.get(refKey(channel, providerId, incidentId)) ?? null;
    },

    async saveRef(channel: string, providerId: string, incidentId: string, ref: string): Promise<void> {
      messageRefs.set(refKey(channel, providerId, incidentId), ref);
      await persist();
    },

    async forgetRef(channel: string, providerId: string, incidentId: string): Promise<void> {
      if (!messageRefs.delete(refKey(channel, providerId, incidentId))) return;
      await persist();
    },

    async close(): Promise<void> {
      // Every mutation already persisted; nothing is held open.
    },
  };
}

async function readState(
  path: string,
): Promise<{ providers: Record<string, ProviderRuntimeState>; messageRefs: Record<string, string> }> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { providers: {}, messageRefs: {} };
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `state file ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const result = fileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `state file ${path} is not a valid version ${FORMAT_VERSION} store: ${result.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    );
  }
  return { providers: result.data.providers, messageRefs: result.data.messageRefs };
}
