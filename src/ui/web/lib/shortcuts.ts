import { ROUTE_PATHS } from "../../routePaths.ts";

/**
 * The keyboard map — roadmap 4.17. GitHub's and Linear's grammar: `g` then a
 * letter goes somewhere, a bare key does one thing. ⌘K stays the palette's own
 * (`CommandPalette`), and is listed in the help sheet by the sheet itself.
 *
 * One table, read by both the matcher below and the help sheet, so a shortcut
 * that works is a shortcut that is listed, and the reverse.
 */
export type ShortcutAction =
  | { kind: "go"; to: string }
  | { kind: "search" }
  | { kind: "poll" }
  | { kind: "help" };

export interface Shortcut {
  /** One key, or the two of a `g` sequence. */
  keys: readonly [string] | readonly ["g", string];
  action: ShortcutAction;
  /** Catalog key for what it does. */
  labelKey: string;
  group: "navigation" | "actions";
}

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: ["g", "o"], action: { kind: "go", to: ROUTE_PATHS.overview }, labelKey: "shortcuts.go-overview", group: "navigation" },
  { keys: ["g", "p"], action: { kind: "go", to: ROUTE_PATHS.providers }, labelKey: "shortcuts.go-providers", group: "navigation" },
  { keys: ["g", "i"], action: { kind: "go", to: ROUTE_PATHS.incidents }, labelKey: "shortcuts.go-incidents", group: "navigation" },
  { keys: ["g", "h"], action: { kind: "go", to: ROUTE_PATHS.history }, labelKey: "shortcuts.go-history", group: "navigation" },
  { keys: ["g", "d"], action: { kind: "go", to: ROUTE_PATHS.deliveryLog }, labelKey: "shortcuts.go-delivery-log", group: "navigation" },
  { keys: ["g", "s"], action: { kind: "go", to: ROUTE_PATHS.settings }, labelKey: "shortcuts.go-settings", group: "navigation" },
  { keys: ["/"], action: { kind: "search" }, labelKey: "shortcuts.search", group: "actions" },
  { keys: ["p"], action: { kind: "poll" }, labelKey: "shortcuts.poll", group: "actions" },
  { keys: ["?"], action: { kind: "help" }, labelKey: "shortcuts.help", group: "actions" },
];

/** How long a `g` waits for its second key before it is forgotten. */
export const SEQUENCE_MS = 1200;

/** What the matcher needs of a key event, so a test need not build a real one. */
export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** Where the key was typed. */
  target: { tagName?: string; isContentEditable?: boolean; getAttribute?: (name: string) => string | null } | null;
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const TYPING_ROLES = new Set(["textbox", "combobox", "searchbox", "spinbutton"]);

/** Whether the key is going into a field — where a letter is a letter, not a command. */
export function isTyping(target: KeyInput["target"]): boolean {
  if (target === null) return false;
  if (target.isContentEditable === true) return true;
  if (target.tagName !== undefined && TYPING_TAGS.has(target.tagName.toUpperCase())) return true;
  const role = target.getAttribute?.("role");
  return role !== null && role !== undefined && TYPING_ROLES.has(role);
}

/**
 * Turns a stream of keys into actions. Holds the one piece of state a sequence
 * needs — a `g` waiting for its partner — and nothing else.
 *
 * `blocked` is the caller's "something modal is open": the keys are still seen,
 * so a half-typed `g` is dropped rather than completed behind the dialog, but
 * nothing runs.
 */
export function createShortcutMatcher() {
  let pendingSince: number | null = null;
  return function feed(input: KeyInput, now: number, blocked = false): ShortcutAction | null {
    // ⌘/Ctrl/Alt chords belong to the browser and the palette; a letter held
    // with one of them is never ours.
    if (input.ctrlKey || input.metaKey || input.altKey) {
      pendingSince = null;
      return null;
    }
    if (blocked || isTyping(input.target)) {
      pendingSince = null;
      return null;
    }
    const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;

    if (pendingSince !== null) {
      const fresh = now - pendingSince <= SEQUENCE_MS;
      pendingSince = null;
      if (fresh) {
        const second = SHORTCUTS.find((entry) => entry.keys.length === 2 && entry.keys[1] === key);
        // Anything that is not a partner cancels the sequence, and is not read
        // as a fresh key either: `g` `p` is "providers", not "g, then poll".
        return second?.action ?? null;
      }
    }
    if (key === "g") {
      pendingSince = now;
      return null;
    }
    return SHORTCUTS.find((entry) => entry.keys.length === 1 && entry.keys[0] === input.key)?.action ?? null;
  };
}
