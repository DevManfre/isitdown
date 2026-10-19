import { MAX_MUTE_MINUTES, type ChatCommand } from "./commands.ts";

/**
 * The two things a notification's buttons can do — roadmap 3.1 — and how a press
 * travels back as a string.
 *
 * A button is a command somebody did not have to type, so an action is a
 * `ChatCommand` rather than a second vocabulary: the press and `/ack github`
 * reach the same backend call through the same `run`, and the two cannot drift.
 * What lives here is only the wire format, kept apart from the transport that
 * carries it (Telegram's `callback_data`) and from the notifier that writes it.
 *
 * Deliberately narrower than the command language: a button can acknowledge and
 * mute, never unmute, ask for history or take any argument the notifier did not
 * itself put there. Whatever arrives from outside is parsed, not trusted.
 */

/** What "Mute 2h" mutes for. Fixed: a button has no way to ask. */
export const ACTION_MUTE_MINUTES = 120;

/** Telegram's own ceiling on `callback_data`, in bytes. */
export const CALLBACK_DATA_LIMIT_BYTES = 64;

export type ActionCommand = Extract<ChatCommand, { kind: "ack" | "mute" }>;

/**
 * The string a button carries, or `null` when it would not fit.
 *
 * `null` rather than a truncated id: a button that acts on the wrong provider is
 * worse than no button, and the notification is complete without one.
 */
export function encodeAction(action: ActionCommand): string | null {
  const data =
    action.kind === "ack"
      ? `ack:${action.providerId}`
      : `mute:${action.providerId}:${action.minutes}`;
  return Buffer.byteLength(data) > CALLBACK_DATA_LIMIT_BYTES ? null : data;
}

/** The action a press carries, or `null` for anything this module did not write. */
export function parseAction(data: string): ActionCommand | null {
  if (data.startsWith("ack:")) {
    const providerId = data.slice("ack:".length);
    return providerId === "" ? null : { kind: "ack", providerId };
  }
  if (data.startsWith("mute:")) {
    // The minutes are the last segment and the id is everything between, so a
    // provider id with a colon in it still round-trips.
    const rest = data.slice("mute:".length);
    const split = rest.lastIndexOf(":");
    if (split <= 0) return null;
    const providerId = rest.slice(0, split);
    const minutesText = rest.slice(split + 1);
    if (!/^\d+$/.test(minutesText)) return null;
    const minutes = Number(minutesText);
    if (minutes < 1 || minutes > MAX_MUTE_MINUTES) return null;
    return { kind: "mute", providerId, minutes };
  }
  return null;
}
