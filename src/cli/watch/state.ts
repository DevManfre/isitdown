import type { OverallStatus, StatusResponse } from "./schema.ts";

/** How the client is currently getting its data — shown in the panel, never hidden as a stack trace. */
export type ConnectionMode = "connecting" | "streaming" | "polling" | "error";

export interface ProviderRow {
  id: string;
  name: string;
  status: OverallStatus;
  /** ISO timestamp this provider was first *observed* at its current status, or `null` before that's known. */
  since: string | null;
  fetchedAt: string | null;
}

export interface ChangeEntry {
  at: string;
  providerId: string;
  providerName: string;
  status: OverallStatus;
}

/** How many rows the trailing queue keeps — older changes fall off rather than scrolling the panel forever. */
export const MAX_CHANGES = 20;

export interface WatchState {
  connection: ConnectionMode;
  /** Set only in `connection: "error"` and `"polling"` — the reason the stream isn't the source right now. */
  errorMessage: string | null;
  providers: ProviderRow[];
  changes: ChangeEntry[];
  lastRefreshAt: string | null;
}

export function initialState(): WatchState {
  return {
    connection: "connecting",
    errorMessage: null,
    providers: [],
    changes: [],
    lastRefreshAt: null,
  };
}

/**
 * Folds a fresh `/status` read into the state. `changedProviderIds` — from
 * the stream's `cycle.changedProviders`, absent on the very first read —
 * decides whose `since` moves to `now`; everyone else keeps whatever `since`
 * they already had, defaulting to `now` the first time a provider is seen at
 * all so the column never reads blank for a provider that never changes.
 */
export function applyStatus(
  state: WatchState,
  status: StatusResponse,
  now: string,
  changedProviderIds: ReadonlySet<string> = new Set(),
): WatchState {
  const previousById = new Map(state.providers.map((row) => [row.id, row]));

  const providers = status.providers.map((provider): ProviderRow => {
    const previous = previousById.get(provider.id);
    const changed = changedProviderIds.has(provider.id) || previous === undefined;
    return {
      id: provider.id,
      name: provider.name,
      status: provider.overallStatus,
      since: changed ? now : (previous?.since ?? now),
      fetchedAt: provider.fetchedAt,
    };
  });

  const newChanges: ChangeEntry[] = providers
    .filter((row) => changedProviderIds.has(row.id) && previousById.has(row.id))
    .map((row) => ({ at: now, providerId: row.id, providerName: row.name, status: row.status }));

  return {
    ...state,
    providers,
    changes: [...newChanges, ...state.changes].slice(0, MAX_CHANGES),
    lastRefreshAt: now,
  };
}
