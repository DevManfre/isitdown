import { ArgsError, DEFAULT_URL } from "../watch/args.ts";

export interface McpArgs {
  url: string;
  /** Empty string means unauthenticated, exactly as for `watch`. */
  token: string;
}

/**
 * `isitdown mcp [--url <url>] [--token <token>]` (roadmap 7.1). The same two
 * options `watch` takes, read the same way — `API_TOKEN` from the environment
 * by default, so the token can sit in an MCP client's `env` block rather than
 * in its `args`, where a config file shared with a colleague would carry it.
 */
export function parseMcpArgs(argv: readonly string[], env: NodeJS.ProcessEnv): McpArgs {
  let url = DEFAULT_URL;
  let token = (env["API_TOKEN"] ?? "").trim();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const value = argv[i + 1];
    if (arg !== "--url" && arg !== "--token") throw new ArgsError("cli.error.unknownOption", { option: arg });
    if (value === undefined) throw new ArgsError("cli.error.missingValue", { option: arg });
    if (arg === "--url") url = value;
    else token = value;
    i++;
  }

  try {
    new URL(url);
  } catch {
    throw new ArgsError("cli.error.invalidUrl", { value: url });
  }

  return { url, token };
}
