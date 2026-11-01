/**
 * What each view was last narrowed to — roadmap 4.16.
 *
 * The address is the truth about a view (a pasted link reopens it exactly); this
 * is only the fallback for an address that says nothing, so that a click on
 * "Incidents" in the rail lands on the filter the operator left it on rather
 * than on the default. Per browser, like the rail's collapsed state: a filter is
 * about how one person is looking, not about the instance.
 *
 * Only values that differ from a view's default are kept. A cleared filter then
 * leaves nothing behind, and "remembered" never means "remembered the default
 * as of last version".
 */
const KEY = "isitdown.views";

type Memory = Record<string, Record<string, string>>;

function read(): Memory {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Memory;
  } catch {
    /* blocked or corrupt storage is just a view that remembers nothing */
    return {};
  }
}

/** One view's remembered values, or an empty record. */
export function recall(view: string): Record<string, string> {
  const entry = read()[view];
  return typeof entry === "object" && entry !== null ? entry : {};
}

/** Keeps one value for a view; `null` forgets it. */
export function remember(view: string, key: string, value: string | null): void {
  try {
    const memory = read();
    const entry = { ...memory[view] };
    if (value === null) delete entry[key];
    else entry[key] = value;
    if (Object.keys(entry).length === 0) delete memory[view];
    else memory[view] = entry;
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* only costs the choice surviving a reload */
  }
}

/** Forgets everything one view held — the "reset this view" end of the feature. */
export function forget(view: string): void {
  try {
    const memory = read();
    delete memory[view];
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* nothing remembered, nothing to forget */
  }
}
