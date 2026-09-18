import type { OverallStatus } from "../types.ts";

/**
 * What an edition has to be able to answer for chatops to work — roadmap 3.18.
 *
 * An interface rather than a direct call into the UI runtime for the same
 * reason `StateStore` and `Notifier` are: `src/core` never imports an edition.
 * It also draws the line of what a chat window may ask for, which is the
 * security surface of the whole feature. There is no method here that reads a
 * channel, a secret or a setting — a bot token pasted into a group chat by an
 * over-eager command is a class of bug this interface makes unwritable.
 */

/** One provider, as a chat reply needs it. */
export interface ChatProvider {
  id: string;
  name: string;
  status: OverallStatus;
  /** Open incidents on the provider's own page. */
  openIncidents: number;
  /** Rolling 90-day uptime, or `null` when nothing has been measured yet. */
  uptime90: number | null;
  /** ISO 8601 while a mute is running; `null` when the provider is not muted. */
  mutedUntil: string | null;
  /** Whether a declared maintenance window is running right now. */
  underMaintenance: boolean;
}

/** One provider's uptime over a window, for `/history`. */
export interface ChatHistory {
  providerId: string;
  name: string;
  days: number;
  /** Percentage, or `null` when the window holds no samples at all. */
  uptime: number | null;
  /** Days in the window that actually carry samples. */
  measuredDays: number;
  incidents: number;
  /** The worst measured day in the window, or `null` when none was measured. */
  worstDay: { day: string; uptime: number } | null;
}

export interface ChatopsBackend {
  /** Enabled providers only: a disabled one is not being watched, so it has no status to report. */
  listProviders(): Promise<ChatProvider[]>;
  history(providerId: string, days: number): Promise<ChatHistory | null>;
  /**
   * Silences a provider until `until` (ISO 8601). The same field the dashboard
   * writes and the diff engine reads, never a filter bolted onto the notifier:
   * a mute asked for from a chat has to be visible on the dashboard, or the
   * operator who set it and the operator who looks are told different things.
   */
  mute(providerId: string, until: string): Promise<void>;
  unmute(providerId: string): Promise<void>;
}
