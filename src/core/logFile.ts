import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

/**
 * Logging to a file, with rotation — roadmap 6.11.
 *
 * stdout is the right answer under Docker, where the daemon already collects,
 * rotates and ships it. It is the wrong answer for the bare-metal install the
 * Light edition is otherwise perfect for: a `node dist/light/index.js` under
 * systemd writes into the journal, and a plain `npm start` in a terminal writes
 * into a terminal that gets closed.
 *
 * So the file is *additional*, never a replacement: setting `LOG_FILE` on a
 * container that is also read with `docker logs` must not blank the log the
 * operator was reading. Rotation is by size and happens in-process — an
 * external `logrotate` would need a reopen signal this daemon does not have.
 */

/** Big enough that a busy fleet rotates daily rather than hourly. */
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
/** How many rotated generations survive beside the live file. */
export const DEFAULT_MAX_FILES = 5;

export interface FileLogOptions {
  path: string;
  maxBytes: number;
  maxFiles: number;
}

/**
 * A size or a count that is unusable falls back to the default rather than
 * failing the boot: refusing to start over a mistyped `LOG_MAX_FILES` would
 * cost an operator their notifications to protect their disk.
 */
const positive = (fallback: number) =>
  z.coerce.number().int().positive().catch(fallback).default(fallback);

export function readFileLogOptions(env: Record<string, string | undefined>): FileLogOptions | null {
  const path = env["LOG_FILE"];
  if (path === undefined || path === "") return null;
  return {
    path,
    maxBytes: positive(DEFAULT_MAX_BYTES).parse(env["LOG_MAX_BYTES"] ?? undefined),
    maxFiles: positive(DEFAULT_MAX_FILES).parse(env["LOG_MAX_FILES"] ?? undefined),
  };
}

/**
 * `isitdown.log` → `isitdown.log.1` → … → `isitdown.log.<maxFiles>`, oldest
 * dropped. Renaming beats copying: the live file is replaced by a new inode
 * rather than truncated, so nothing is lost between the copy and the truncate.
 */
function rotate({ path, maxFiles }: FileLogOptions): void {
  rmSync(`${path}.${maxFiles}`, { force: true });
  for (let generation = maxFiles - 1; generation >= 1; generation -= 1) {
    try {
      renameSync(`${path}.${generation}`, `${path}.${generation + 1}`);
    } catch {
      // That generation does not exist yet — the usual case on a young install.
    }
  }
  renameSync(path, `${path}.1`);
}

/**
 * The writer `createLogger` is handed: stdout always, plus the file when one is
 * configured.
 *
 * Writes are synchronous. A logger is called from every layer including the
 * error paths, and an async write would reorder lines against the stdout copy
 * and could still be in flight when the process exits on a failed boot.
 *
 * A file that cannot be written is reported on stdout once and then given up
 * on: an unwritable path is a deployment mistake, and retrying it per line
 * would turn one mistake into a second log full of the same complaint.
 */
export function createLogWriter(
  options: FileLogOptions | null,
  stdout: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): (line: string) => void {
  if (options === null) return stdout;

  let size = 0;
  let enabled = true;

  const disable = (error: unknown): void => {
    enabled = false;
    stdout(
      JSON.stringify({
        time: new Date().toISOString(),
        level: "error",
        msg: "file logging disabled",
        path: options.path,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  };

  try {
    mkdirSync(dirname(options.path), { recursive: true });
    const stats = statSync(options.path);
    // A path that is a directory is caught here rather than at the first write:
    // appending to it fails, but *rotating* it would rename the directory.
    if (!stats.isFile()) throw new Error(`${options.path} is not a regular file`);
    size = stats.size;
  } catch (error) {
    // A missing file is the first run, not a failure; anything else is.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") disable(error);
  }

  return (line: string): void => {
    stdout(line);
    if (!enabled) return;

    const bytes = Buffer.byteLength(line) + 1;
    try {
      // Rotation is decided before the write, so a line is never split across
      // two generations. A single line larger than the limit still lands whole.
      if (size > 0 && size + bytes > options.maxBytes) {
        rotate(options);
        size = 0;
      }
      appendFileSync(options.path, `${line}\n`);
      size += bytes;
    } catch (error) {
      disable(error);
    }
  };
}
