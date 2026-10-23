import type { DatabaseSync } from "node:sqlite";
import type { Logger } from "../core/logger.ts";
import { DEFAULT_LAYOUT, type DashboardLayout } from "./dashboardLayout.ts";
import { layoutSchema } from "./dashboardLayoutSchema.ts";

/**
 * The composable Overview's storage — roadmap 4.1.
 *
 * A NULL layout is "follow the default in code", and every read resolves it, so
 * the dashboard always receives a concrete list. `updatedAt` is the version a
 * save is checked against: two tabs editing the same Overview must not have the
 * later save silently erase the earlier one.
 */
export interface Dashboard {
  id: string;
  name: string;
  layout: DashboardLayout;
  isDefault: boolean;
  /** The stored JSON could not be read; the default is served in its place. */
  layoutInvalid?: true;
  updatedAt: string;
}

interface Row {
  id: string;
  name: string;
  layout: string | null;
  updated_at: string;
}

export type SaveResult = { kind: "saved"; dashboard: Dashboard } | { kind: "conflict"; current: Dashboard };

export function createDashboardStore(db: DatabaseSync, logger: Logger) {
  const row = (id: string): Row | undefined =>
    db.prepare("SELECT id, name, layout, updated_at FROM dashboards WHERE id = ?").get(id) as Row | undefined;

  function resolve(stored: Row): Dashboard {
    const base = { id: stored.id, name: stored.name, updatedAt: stored.updated_at };
    if (stored.layout === null) return { ...base, layout: DEFAULT_LAYOUT, isDefault: true };
    let parsed: ReturnType<typeof layoutSchema.safeParse>;
    try {
      parsed = layoutSchema.safeParse(JSON.parse(stored.layout));
    } catch {
      parsed = layoutSchema.safeParse(undefined);
    }
    if (parsed.success) return { ...base, layout: parsed.data, isDefault: false };
    // A hand-edited database or a layout written by a newer release. The
    // Overview still has to draw, so it draws the default and says why.
    logger.warn("stored dashboard layout is unreadable; serving the default", { dashboard: stored.id });
    return { ...base, layout: DEFAULT_LAYOUT, isDefault: true, layoutInvalid: true };
  }

  /**
   * Strictly later than the last write, even inside the same millisecond, or a
   * second save could carry the version the first one just wrote and pass the
   * conflict check it should fail.
   */
  function nextVersion(previous: string): string {
    const now = Date.now();
    const last = Date.parse(previous);
    return new Date(Number.isNaN(last) || now > last ? now : last + 1).toISOString();
  }

  function write(id: string, layout: string | null, previous: string): Dashboard {
    db.prepare("UPDATE dashboards SET layout = ?, updated_at = ? WHERE id = ?").run(layout, nextVersion(previous), id);
    return resolve(row(id) as Row);
  }

  return {
    get(id: string): Dashboard | undefined {
      const stored = row(id);
      return stored === undefined ? undefined : resolve(stored);
    },

    save(id: string, layout: DashboardLayout, basedOn: string): SaveResult | undefined {
      const stored = row(id);
      if (stored === undefined) return undefined;
      if (stored.updated_at !== basedOn) return { kind: "conflict", current: resolve(stored) };
      return { kind: "saved", dashboard: write(id, JSON.stringify(layout), stored.updated_at) };
    },

    reset(id: string): Dashboard | undefined {
      const stored = row(id);
      return stored === undefined ? undefined : write(id, null, stored.updated_at);
    },
  };
}
