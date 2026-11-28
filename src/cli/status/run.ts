import { SOURCE_LOCALE, t } from "../../core/i18n/index.ts";
import { createReadApi, type ReadApi } from "../mcp/api.ts";
import { ArgsError } from "../watch/args.ts";
import { HttpStatusError } from "../watch/client.ts";
import { statusResponseSchema, type OverallStatus, type ProviderStatus } from "../watch/schema.ts";
import { parseStatusArgs, type StatusArgs } from "./args.ts";

type Translate = (key: string, params?: Record<string, string>) => string;
const translate: Translate = (key, params) => t(SOURCE_LOCALE, key, params);

export const STATUS_USAGE = translate("cli.status.usage");

/**
 * The exit codes `--exit-code` promises (roadmap 12.2). `USAGE` is outside the
 * 0–3 range on purpose: a typo in a deploy script must not read as "something is
 * down".
 */
export const EXIT = { OPERATIONAL: 0, DEGRADED: 1, DOWN: 2, UNREACHABLE: 3, USAGE: 64 } as const;

/** The fleet's verdict: the worst of what was kept. */
export type Overall = "operational" | "degraded" | "down";

/**
 * `major_outage` is down; anything else short of operational — degraded, a
 * partial outage, or a reading the instance could not take — is degraded: it is
 * worth a look, but it is not "don't deploy".
 */
function levelOf(status: OverallStatus): Overall {
  if (status === "operational") return "operational";
  if (status === "major_outage") return "down";
  return "degraded";
}

const RANK: Record<Overall, number> = { operational: 0, degraded: 1, down: 2 };

export function overallOf(providers: readonly ProviderStatus[]): Overall {
  let worst: Overall = "operational";
  for (const provider of providers) {
    const level = levelOf(provider.overallStatus);
    if (RANK[level] > RANK[worst]) worst = level;
  }
  return worst;
}

const STATUS_KEY: Record<OverallStatus, string> = {
  operational: "status.operational",
  degraded: "status.degraded",
  partial_outage: "status.partial-outage",
  major_outage: "status.major-outage",
  unknown: "status.unknown",
};

export interface StatusDeps {
  api: ReadApi;
  out(text: string): void;
  err(text: string): void;
}

/**
 * Reads `/status` once, prints it, and answers with the exit code. Every failure
 * to get an answer — unreachable, rejected token, a body of the wrong shape —
 * is `UNREACHABLE` whether or not `--exit-code` was given: the command could not
 * do what it was asked.
 */
export async function runStatus(args: StatusArgs, deps: StatusDeps): Promise<number> {
  let providers: ProviderStatus[];
  let serverNow: string;
  try {
    const body = await deps.api.get("/status", {}, statusResponseSchema);
    providers = body.providers.filter((provider) => provider.enabled);
    serverNow = body.serverNow;
  } catch (error) {
    deps.err(`${describeFailure(error)}\n`);
    return EXIT.UNREACHABLE;
  }

  if (args.providers.length > 0) {
    const unknown = args.providers.filter((id) => !providers.some((provider) => provider.id === id));
    if (unknown.length > 0) {
      deps.err(`${translate("cli.status.error.unknownProvider", { ids: unknown.join(", ") })}\n`);
      return EXIT.USAGE;
    }
    providers = providers.filter((provider) => args.providers.includes(provider.id));
  }

  const overall = overallOf(providers);
  if (args.json) {
    deps.out(
      `${JSON.stringify(
        {
          overall,
          serverNow,
          providers: providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            status: provider.overallStatus,
            fetchedAt: provider.fetchedAt,
          })),
        },
        null,
        2,
      )}\n`,
    );
  } else {
    const troubled = providers.filter((provider) => provider.overallStatus !== "operational");
    if (troubled.length === 0) {
      deps.out(`${translate("cli.status.allOperational", { count: String(providers.length) })}\n`);
    }
    for (const provider of troubled) {
      deps.out(
        `${translate("cli.status.line", {
          name: provider.name,
          id: provider.id,
          status: translate(STATUS_KEY[provider.overallStatus]),
        })}\n`,
      );
    }
  }

  if (!args.exitCode) return EXIT.OPERATIONAL;
  return overall === "down" ? EXIT.DOWN : overall === "degraded" ? EXIT.DEGRADED : EXIT.OPERATIONAL;
}

function describeFailure(error: unknown): string {
  if (error instanceof HttpStatusError && error.status === 401) return translate("cli.watch.error.unauthorized");
  if (error instanceof HttpStatusError && error.status === 403) return translate("cli.watch.error.forbidden");
  const reason = error instanceof Error ? error.message : String(error);
  return translate("cli.status.error.failed", { reason });
}

export async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  let args: StatusArgs;
  try {
    args = parseStatusArgs(argv, env);
  } catch (error) {
    if (error instanceof ArgsError) {
      process.stderr.write(`${translate(error.key, error.params)}\n\n${STATUS_USAGE}`);
      return EXIT.USAGE;
    }
    throw error;
  }
  return runStatus(args, {
    api: createReadApi(args.url, args.token),
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
