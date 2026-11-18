import { fakeResponse, type Fixtures } from "@/test/fakeApi.ts";

/*
 * Imported first by the catalog's entry, before anything that reads storage or
 * the network: `lib/i18n.ts` reads the remembered locale the moment it loads.
 *
 * A story frame shares its origin with the dev dashboard on :5173, so a story
 * that seeds a folded card open, or a theme that writes itself back, would
 * otherwise change the operator's own dashboard in the next tab. Storage is
 * therefore an in-memory copy per frame, and `fetch` answers from the story's
 * fixtures — the frame never talks to the server at all.
 */

class MemoryStorage implements Storage {
  #items = new Map<string, string>();
  get length() {
    return this.#items.size;
  }
  clear() {
    this.#items.clear();
  }
  getItem(key: string) {
    return this.#items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.#items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.#items.delete(key);
  }
  setItem(key: string, value: string) {
    this.#items.set(key, String(value));
  }
}

const storage = new MemoryStorage();
Object.defineProperty(window, "localStorage", { value: storage, configurable: true });

// The frame's theme and language come from its address, so one catalog page
// can show the same story light and dark, in any locale, side by side.
const params = new URLSearchParams(location.search);
storage.setItem("isitdown.theme", params.get("theme") ?? "light");
storage.setItem("isitdown.uiLocale", params.get("locale") ?? "en");
document.documentElement.setAttribute("data-theme", params.get("theme") === "dark" ? "dark" : "light");

let current: Fixtures = {};

/** What every request answers from until the next call. */
export function serveFixtures(fixtures: Fixtures): void {
  current = fixtures;
}

window.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  return fakeResponse(current, url.pathname + url.search);
}) as typeof fetch;
