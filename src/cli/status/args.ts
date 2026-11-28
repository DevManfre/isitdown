import { ArgsError, DEFAULT_URL } from "../watch/args.ts";

export interface StatusArgs {
  url: string;
  /** Empty string means unauthenticated, exactly as `watch`. */
  token: string;
  /** Provider ids to keep; empty keeps every enabled provider. */
  providers: string[];
  json: boolean;
  exitCode: boolean;
}

/**
 * `isitdown status [--url] [--token] [--provider a,b] [--json] [--exit-code]`
 * (roadmap 12.2). Meant for scripts, so both connection settings also come from
 * the environment: `ISITDOWN_URL` and `ISITDOWN_TOKEN`, with `API_TOKEN` — the
 * name `watch` and `mcp` read — still accepted after `ISITDOWN_TOKEN`.
 */
export function parseStatusArgs(argv: readonly string[], env: NodeJS.ProcessEnv): StatusArgs {
  let url = (env["ISITDOWN_URL"] ?? "").trim() || DEFAULT_URL;
  let token = (env["ISITDOWN_TOKEN"] ?? "").trim() || (env["API_TOKEN"] ?? "").trim();
  const providers: string[] = [];
  let json = false;
  let exitCode = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--exit-code") {
      exitCode = true;
      continue;
    }
    if (arg !== "--url" && arg !== "--token" && arg !== "--provider") {
      throw new ArgsError("cli.error.unknownOption", { option: arg });
    }
    const value = argv[i + 1];
    if (value === undefined) throw new ArgsError("cli.error.missingValue", { option: arg });
    i++;
    if (arg === "--url") url = value;
    else if (arg === "--token") token = value.trim();
    else providers.push(...value.split(",").map((id) => id.trim()).filter((id) => id !== ""));
  }

  try {
    new URL(url);
  } catch {
    throw new ArgsError("cli.error.invalidUrl", { value: url });
  }
  return { url, token, providers, json, exitCode };
}
