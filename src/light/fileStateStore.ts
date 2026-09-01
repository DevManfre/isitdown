import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { providerRuntimeStateSchema } from "../core/status.schema.ts";
import type { ProviderRuntimeState, StateStore } from "../core/stateStore.interface.ts";
import type { NormalizedStatus } from "../core/types.ts";

const FORMAT_VERSION = 1;

const fileSchema = z.object({
  version: z.literal(FORMAT_VERSION),
  providers: z.record(providerRuntimeStateSchema),
});

const baseline = (): ProviderRuntimeState => ({
  last: null,
  failureCount: 0,
  degradedNotified: false,
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
export async function createFileStateStore(path: string): Promise<StateStore> {
  const providers = new Map<string, ProviderRuntimeState>(Object.entries(await readState(path)));

  // A cycle polls every provider concurrently, so several mutations land at once.
  // Writes are serialised and each uses its own temporary file: sharing one
  // temporary name let two concurrent renames race, and the loser failed with
  // ENOENT after the winner had already moved the file into place.
  let writes = 0;
  let tail: Promise<unknown> = Promise.resolve();

  async function writeOnce(): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const payload = JSON.stringify(
      { version: FORMAT_VERSION, providers: Object.fromEntries(providers) },
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

    async close(): Promise<void> {
      // Every mutation already persisted; nothing is held open.
    },
  };
}

async function readState(path: string): Promise<Record<string, ProviderRuntimeState>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
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
  return result.data.providers;
}
