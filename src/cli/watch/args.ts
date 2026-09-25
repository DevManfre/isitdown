export const DEFAULT_URL = "http://localhost:3000";
export const DEFAULT_INTERVAL_SECONDS = 30;

export interface WatchArgs {
  url: string;
  /** Empty string means unauthenticated — the same "no token" the server itself treats as the feature being off. */
  token: string;
  intervalMs: number;
}

/** Carries the i18n key and params for the message, rather than pre-rendered text — `index.ts` is what has a locale. */
export class ArgsError extends Error {
  readonly key: string;
  readonly params: Record<string, string>;

  constructor(key: string, params: Record<string, string> = {}) {
    super(key);
    this.name = "ArgsError";
    this.key = key;
    this.params = params;
  }
}

function requireValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined) throw new ArgsError("cli.error.missingValue", { option });
  return value;
}

function parseIntervalSeconds(raw: string): number {
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new ArgsError("cli.error.invalidInterval", { value: raw });
  }
  return seconds;
}

/**
 * `isitdown watch [--url <url>] [--token <token>] [--interval <seconds>]` —
 * the command's only options (roadmap 17.7). `API_TOKEN` from the
 * environment is the default so a token never has to be typed on a command
 * line where a shell history or a `ps` listing could catch it; `--token`
 * exists for a shell that doesn't share that environment.
 */
export function parseWatchArgs(argv: readonly string[], env: NodeJS.ProcessEnv): WatchArgs {
  let url = DEFAULT_URL;
  let token = (env["API_TOKEN"] ?? "").trim();
  let intervalSeconds = DEFAULT_INTERVAL_SECONDS;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    switch (arg) {
      case "--url":
        url = requireValue(argv, ++i, "--url");
        break;
      case "--token":
        token = requireValue(argv, ++i, "--token");
        break;
      case "--interval":
        intervalSeconds = parseIntervalSeconds(requireValue(argv, ++i, "--interval"));
        break;
      default:
        throw new ArgsError("cli.error.unknownOption", { option: arg });
    }
  }

  try {
    new URL(url);
  } catch {
    throw new ArgsError("cli.error.invalidUrl", { value: url });
  }

  return { url, token, intervalMs: intervalSeconds * 1000 };
}
