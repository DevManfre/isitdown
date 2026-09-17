/**
 * The chatops command language — roadmap 3.18.
 *
 * Parsing lives here, apart from both the transport that receives a message and
 * the backend that answers it, because it is the part with no I/O in it at all:
 * a string in, a decided command out. That is also what keeps the language
 * small. There are five verbs and no flags, and adding a sixth means adding a
 * member to this union rather than a branch to a reader somewhere.
 *
 * Deliberately *not* a shell: no quoting, no pipes, no `--options`. A chat
 * window is a bad place to discover you typed a quote wrong, and every command
 * here has to be typeable on a phone with one thumb.
 */

/** The longest mute this language can express. */
export const MAX_MUTE_MINUTES = 30 * 24 * 60;

export type ChatCommand =
  | { kind: "help" }
  | { kind: "status"; providerId?: string | undefined }
  | { kind: "history"; providerId: string; days: 7 | 30 | 90 }
  | { kind: "mute"; providerId: string; minutes: number }
  | { kind: "unmute"; providerId: string };

export type ParseResult =
  | { ok: true; command: ChatCommand }
  /**
   * `key` is a catalog key rather than a sentence: a refusal is read by the
   * same person as an answer, so it is translated the same way (the project's
   * i18n rule), and the transport never has to carry English of its own.
   */
  | { ok: false; key: string; params?: Record<string, string | number> };

/**
 * `2h`, `30m`, `1d` — and a bare number read as minutes, because `/mute github
 * 30` is what people type before they read any help.
 *
 * Returns `null` for anything else rather than guessing: a mute is silence, and
 * silence for a misread duration is the failure worth avoiding here.
 */
export function parseDurationMinutes(input: string): number | null {
  const match = /^(\d+)\s*(m|min|mins|h|hr|hrs|d)?$/i.exec(input.trim());
  if (match?.[1] === undefined) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = (match[2] ?? "m").toLowerCase();
  const minutes = unit.startsWith("d") ? amount * 1440 : unit.startsWith("h") ? amount * 60 : amount;
  return minutes > MAX_MUTE_MINUTES ? null : minutes;
}

/**
 * Splits the leading verb off a message.
 *
 * Telegram addresses a command to a specific bot when several share a group
 * (`/status@isitdown_bot`), so the suffix is stripped before anything looks at
 * the verb — otherwise every command in a group chat would read as unknown.
 */
function words(text: string): { verb: string; rest: string[] } | null {
  const parts = text.trim().split(/\s+/).filter((part) => part.length > 0);
  const first = parts[0];
  if (first === undefined || !first.startsWith("/")) return null;
  const verb = first.slice(1).split("@")[0]?.toLowerCase() ?? "";
  return { verb, rest: parts.slice(1) };
}

/**
 * A message from a chat into a command, or a reason it is not one.
 *
 * Anything that does not start with `/` is not a refusal but a non-command:
 * people talk in these chats, and a bot that answers "unknown command" to every
 * sentence is a bot that gets removed from the group. The caller gets `null`
 * and says nothing.
 */
export function parseCommand(text: string): ParseResult | null {
  const parsed = words(text);
  if (parsed === null) return null;
  const { verb, rest } = parsed;

  switch (verb) {
    case "help":
    case "start":
      return { ok: true, command: { kind: "help" } };

    case "status": {
      const providerId = rest[0];
      return { ok: true, command: { kind: "status", providerId: providerId?.toLowerCase() } };
    }

    case "history": {
      const providerId = rest[0];
      if (providerId === undefined) return { ok: false, key: "chatops.error.provider-required" };
      const window = rest[1];
      // The three windows the History view already offers, and nothing else:
      // an arbitrary day count here would answer a question the dashboard
      // cannot, and the two would start disagreeing about what "uptime" means.
      if (window !== undefined && !["7", "30", "90"].includes(window)) {
        return { ok: false, key: "chatops.error.bad-window", params: { window } };
      }
      const days = window === undefined ? 30 : (Number(window) as 7 | 30 | 90);
      return { ok: true, command: { kind: "history", providerId: providerId.toLowerCase(), days } };
    }

    case "mute": {
      const providerId = rest[0];
      if (providerId === undefined) return { ok: false, key: "chatops.error.provider-required" };
      const duration = rest[1];
      if (duration === undefined) return { ok: false, key: "chatops.error.duration-required" };
      const minutes = parseDurationMinutes(duration);
      if (minutes === null) {
        return { ok: false, key: "chatops.error.bad-duration", params: { duration } };
      }
      return { ok: true, command: { kind: "mute", providerId: providerId.toLowerCase(), minutes } };
    }

    case "unmute": {
      const providerId = rest[0];
      if (providerId === undefined) return { ok: false, key: "chatops.error.provider-required" };
      return { ok: true, command: { kind: "unmute", providerId: providerId.toLowerCase() } };
    }

    default:
      return { ok: false, key: "chatops.error.unknown-command", params: { command: verb } };
  }
}
