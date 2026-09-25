import { SOURCE_LOCALE, t } from "../../core/i18n/index.ts";
import { parseWatchArgs, ArgsError, type WatchArgs } from "./args.ts";
import { createApiClient } from "./client.ts";
import { CLEAR_SCREEN, render } from "./render.ts";
import { runWatch } from "./watcher.ts";
import type { WatchState } from "./state.ts";
import type { Translate } from "./watcher.ts";

const translate: Translate = (key, params) => t(SOURCE_LOCALE, key, params);

export const WATCH_USAGE = translate("cli.watch.usage");

/**
 * The one piece of this feature that touches a real terminal, a real clock
 * and a real network — deliberately thin (skill guidance: isolate what a
 * test can't reach behind a function this small) so everything it calls,
 * `runWatch` and `render`, is exercised against a fake server instead.
 */
export async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  let args: WatchArgs;
  try {
    args = parseWatchArgs(argv, env);
  } catch (error) {
    if (error instanceof ArgsError) {
      process.stderr.write(`${translate(error.key, error.params)}\n\n${WATCH_USAGE}`);
      return 2;
    }
    throw error;
  }

  const client = createApiClient(args.url, args.token);
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());

  const draw = (state: WatchState): void => {
    process.stdout.write(CLEAR_SCREEN + render(args.url, state, translate));
  };

  await runWatch(args.url, {
    client,
    translate,
    intervalMs: args.intervalMs,
    onState: draw,
    signal: controller.signal,
  });

  return 0;
}
