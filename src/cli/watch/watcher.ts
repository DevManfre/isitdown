import { HttpStatusError, InvalidResponseError, type ApiClient } from "./client.ts";
import { applyStatus, initialState, type WatchState } from "./state.ts";

/** `t(SOURCE_LOCALE, key, params)` — kept generic here so `watcher.ts` stays free of the i18n import. */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface RunWatchOptions {
  client: ApiClient;
  translate: Translate;
  intervalMs: number;
  onState: (state: WatchState) => void;
  signal: AbortSignal;
  /** Real time by default; overridden by tests so a dropped stream doesn't cost the suite `intervalMs` in wall time. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => string;
}

async function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function isAuthError(error: unknown): error is HttpStatusError {
  return error instanceof HttpStatusError && (error.status === 401 || error.status === 403);
}

function describeError(error: unknown, translate: Translate, url: string): string {
  if (error instanceof HttpStatusError) {
    if (error.status === 401) return translate("cli.watch.error.unauthorized");
    if (error.status === 403) return translate("cli.watch.error.forbidden");
    return translate("cli.watch.error.network", { url, reason: error.message });
  }
  if (error instanceof InvalidResponseError) {
    return translate("cli.watch.error.invalidResponse", { url, reason: error.message });
  }
  return translate("cli.watch.error.network", {
    url,
    reason: error instanceof Error ? error.message : String(error),
  });
}

/**
 * The whole client loop (roadmap 17.7): read `/status`, then let `/events`
 * drive it — a `cycle` frame means "read `/status` again", not "here is what
 * changed" (`liveEvents.ts` never carries provider payloads). Falls back to
 * polling `/status` on `intervalMs` whenever the stream won't open or drops,
 * and keeps retrying the stream in the background so a reconnect is a
 * silent upgrade rather than something the operator has to restart the
 * process for. A rejected token (401/403) is the one error this doesn't
 * retry: nothing about waiting fixes a wrong credential.
 */
export async function runWatch(baseUrl: string, options: RunWatchOptions): Promise<void> {
  const { client, translate, intervalMs, onState, signal } = options;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => new Date().toISOString());

  let state = initialState();
  const emit = (patch: Partial<WatchState>): void => {
    state = { ...state, ...patch };
    onState(state);
  };

  emit({ connection: "connecting" });

  while (!signal.aborted) {
    try {
      const status = await client.fetchStatus(signal);
      state = applyStatus(state, status, now());
      emit({ connection: "streaming", errorMessage: null });
    } catch (error) {
      if (signal.aborted) return;
      if (isAuthError(error)) {
        emit({ connection: "error", errorMessage: describeError(error, translate, baseUrl) });
        return;
      }
      emit({ connection: "error", errorMessage: describeError(error, translate, baseUrl) });
      await sleep(intervalMs, signal);
      continue;
    }

    try {
      await client.openEventStream(async (event) => {
        if (event.type !== "cycle") return;
        try {
          const status = await client.fetchStatus(signal);
          state = applyStatus(state, status, now(), new Set(event.data.changedProviders));
          emit({ connection: "streaming", errorMessage: null });
        } catch (error) {
          if (isAuthError(error)) throw error;
          // A refresh triggered by a live cycle failing is transient — the
          // stream itself is still open — so it's surfaced without dropping
          // to polling mode over one bad read.
          emit({ errorMessage: describeError(error, translate, baseUrl) });
        }
      }, signal);
      // The stream ended on its own (the server closed it) rather than
      // throwing; either way the loop falls through to polling below and
      // tries again after `intervalMs`, so a silent drop never means a
      // silently stalled view.
    } catch (error) {
      if (signal.aborted) return;
      if (isAuthError(error)) {
        emit({ connection: "error", errorMessage: describeError(error, translate, baseUrl) });
        return;
      }
    }

    if (signal.aborted) return;
    emit({
      connection: "polling",
      errorMessage: translate("cli.watch.status.polling", { seconds: Math.round(intervalMs / 1000) }),
    });
    await sleep(intervalMs, signal);
  }
}
