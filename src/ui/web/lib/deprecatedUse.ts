/**
 * Which deprecated dashboard surfaces this browser has used — roadmap 16.3.
 *
 * The server cannot tell: the wallboard is a client-side route and installing
 * the app happens in the browser. So the browser remembers it itself, in its
 * own storage, and only ever hands it over inside the usage report the
 * operator copies by hand. Nothing here is sent anywhere.
 */
const KEY = "isitdown.deprecated-use";

export type DeprecatedSurface = "wallboard" | "installed-app";

function read(): DeprecatedSurface[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((entry): entry is DeprecatedSurface => typeof entry === "string") : [];
  } catch {
    // Blocked or corrupt storage only costs the memory of having used it.
    return [];
  }
}

export function noteDeprecatedUse(surface: DeprecatedSurface): void {
  const seen = read();
  if (seen.includes(surface)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...seen, surface]));
  } catch {
    /* see read() */
  }
}

export const deprecatedUse = (): DeprecatedSurface[] => read();
