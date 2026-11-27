import { SOURCE_LOCALE, t } from "../../core/i18n/index.ts";
import { ArgsError } from "../watch/args.ts";
import { parseMcpArgs, type McpArgs } from "./args.ts";
import { createReadApi } from "./api.ts";
import { serveMcp } from "./server.ts";
import { TOOLS } from "./tools.ts";

export const MCP_USAGE = t(SOURCE_LOCALE, "cli.mcp.usage");

/**
 * The thin edge that touches real stdio and a real network (roadmap 7.1) —
 * everything it wires together is exercised against a fake client and a fake
 * server instead. stdout belongs to the protocol, so the only thing this ever
 * prints outside it is a usage error, on stderr, before serving starts.
 */
export async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  let args: McpArgs;
  try {
    args = parseMcpArgs(argv, env);
  } catch (error) {
    if (error instanceof ArgsError) {
      process.stderr.write(`${t(SOURCE_LOCALE, error.key, error.params)}\n\n${MCP_USAGE}`);
      return 2;
    }
    throw error;
  }

  await serveMcp(process.stdin, process.stdout, TOOLS, {
    api: createReadApi(args.url, args.token),
    now: () => new Date(),
  });
  return 0;
}
