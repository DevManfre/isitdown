import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Logger } from "../core/logger.ts";

/** Long enough for any webhook URL or bot token, short enough not to be a payload. */
const MAX_VALUE_LENGTH = 4096;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FILE_MODE = 0o600;

export interface SecretsFile {
  /**
   * Whether this file, rather than the container's environment, is where the
   * variable's value came from — the only thing `clear` is allowed to remove.
   */
  owns(name: string): boolean;
  /** All or nothing: every pair is validated before any of them is written. */
  set(values: Record<string, string>): Promise<void>;
  /** False when the file does not own the variable, in which case nothing changes. */
  clear(name: string): Promise<boolean>;
}

/**
 * The credentials an operator saved from the dashboard, kept beside the database
 * in the data volume rather than in it: the environment variable stays the one
 * way a notifier reads a secret, and the database still holds nothing but the
 * *name* of the variable (see `dbConfigSource.ts`).
 *
 * Applying an entry means writing it into the environment object the runtime was
 * built with — the same object `describeChannels` and the config source resolve
 * names against, so a save takes effect on the next request and the next poll
 * cycle with nothing to restart.
 *
 * The file wins over a variable the container already supplied. A dashboard save
 * is an explicit, later instruction than the `env_file` the container booted
 * with, and an operator who cannot override what compose injected has no way to
 * fix a wrong value from the dashboard at all. Every takeover is logged, so the
 * surprise is visible in `docker logs` rather than silent.
 *
 * Values are single-line and length-capped: the file's format is `NAME=value`
 * per line, so a value carrying a newline could otherwise forge a second entry
 * and point another channel's variable at a secret of the caller's choosing.
 */
export async function loadSecretsFile(
  path: string,
  env: NodeJS.ProcessEnv,
  logger: Logger,
): Promise<SecretsFile> {
  const entries = new Map<string, string>(Object.entries(await read(path, logger)));
  // What the environment held before an entry overrode it, so forgetting a
  // saved credential falls back to the container's own value rather than
  // leaving the channel with nothing until the next restart.
  const overridden = new Map<string, string | undefined>();

  for (const [name, value] of entries) {
    overridden.set(name, env[name]);
    if (env[name] !== undefined && env[name] !== value) {
      logger.warn("a saved credential is overriding the variable the container supplied", { name });
    }
    env[name] = value;
  }

  // Writes are serialised through one chain, each with its own temporary file:
  // two concurrent renames sharing a name let the loser fail with ENOENT after
  // the winner had already moved the file into place (fileStateStore.ts hit
  // exactly this).
  let writes = 0;
  let tail: Promise<unknown> = Promise.resolve();

  async function writeOnce(): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const payload = [...entries].map(([name, value]) => `${name}=${value}`).join("\n");
    writes += 1;
    const temporary = join(dirname(path), `.secrets.${process.pid}.${writes}.tmp`);
    await writeFile(temporary, payload === "" ? "" : `${payload}\n`, { encoding: "utf8", mode: FILE_MODE });
    await rename(temporary, path);
  }

  function persist(): Promise<void> {
    const run = tail.then(writeOnce, writeOnce);
    tail = run.catch(() => undefined);
    return run;
  }

  return {
    owns: (name) => entries.has(name),

    async set(values) {
      for (const [name, value] of Object.entries(values)) {
        if (!VARIABLE_NAME.test(name)) {
          throw new Error(`"${name}" is not an environment variable name`);
        }
        if (value.trim() === "") {
          throw new Error(`${name}: a credential cannot be blank`);
        }
        if (value.length > MAX_VALUE_LENGTH) {
          throw new Error(`${name}: a credential cannot be longer than ${MAX_VALUE_LENGTH} characters`);
        }
        if (/[\r\n]/.test(value)) {
          throw new Error(`${name}: a credential cannot contain a line break`);
        }
      }

      for (const [name, value] of Object.entries(values)) entries.set(name, value);
      await persist();
      for (const [name, value] of Object.entries(values)) {
        if (!overridden.has(name)) overridden.set(name, env[name]);
        env[name] = value;
      }
    },

    async clear(name) {
      if (!entries.delete(name)) return false;
      await persist();
      const before = overridden.get(name);
      overridden.delete(name);
      if (before === undefined) delete env[name];
      else env[name] = before;
      return true;
    },
  };
}

/** A hand-edited or partly-written file drops its unusable lines rather than refusing to boot. */
async function read(path: string, logger: Logger): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }

  const entries: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    const name = separator === -1 ? "" : trimmed.slice(0, separator);
    if (!VARIABLE_NAME.test(name)) {
      logger.warn("skipping an unreadable line in the saved credentials file", { path });
      continue;
    }
    entries[name] = trimmed.slice(separator + 1);
  }
  return entries;
}
