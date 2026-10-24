import type { DatabaseSync } from "node:sqlite";
import type { Logger } from "../core/logger.ts";
import { DEFAULT_LAYOUT, type DashboardLayout } from "./dashboardLayout.ts";
import { layoutSchema } from "./dashboardLayoutSchema.ts";

/**
 * The composable Overview's storage — roadmap 4.1, and since 4.2 more than one:
 * named dashboards, kept in the rail's order, one of them home.
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
  /** The one the Overview opens on. Exactly one dashboard is home. */
  home: boolean;
  /** The stored JSON could not be read; the default is served in its place. */
  layoutInvalid?: true;
  updatedAt: string;
}

/** One rail entry: everything but the layout, which only the open dashboard needs. */
export type DashboardSummary = Omit<Dashboard, "layout" | "layoutInvalid">;

interface Row {
  id: string;
  name: string;
  layout: string | null;
  updated_at: string;
}

/** Past this the rail stops being a short list to pick from. */
export const MAX_DASHBOARDS = 20;
export const MAX_NAME_LENGTH = 60;

/**
 * What an export carries and an import accepts — roadmap 4.2. The layout is
 * always concrete: a dashboard following the default exports what it draws, so
 * the file means the same thing on an install running another release.
 */
export interface DashboardExport {
  format: "isitdown.dashboard";
  version: 1;
  name: string;
  layout: DashboardLayout;
}

export type SaveResult = { kind: "saved"; dashboard: Dashboard } | { kind: "conflict"; current: Dashboard };
export type CreateResult = { kind: "created"; dashboard: Dashboard } | { kind: "name-taken" } | { kind: "full" };
export type UpdateResult = { kind: "updated"; dashboard: Dashboard } | { kind: "name-taken" } | undefined;
/**
 * What a delete hands back, so the dashboard can offer Undo: the row as it
 * was, layout still the stored JSON (or NULL) rather than the resolved copy.
 */
export interface RemovedDashboard {
  id: string;
  name: string;
  layout: string | null;
  position: number;
  home: boolean;
}
export type RemoveResult = { kind: "removed"; removed: RemovedDashboard } | { kind: "last" } | undefined;
export type RestoreResult = CreateResult | { kind: "id-taken" };

/**
 * A readable id from a name: "Vendor che pago" is `vendor-che-pago`. Fixed at
 * creation, so a rename never breaks a bookmarked `#/overview/<id>`.
 */
function slugOf(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return slug === "" ? "dashboard" : slug;
}

export function createDashboardStore(db: DatabaseSync, logger: Logger) {
  const row = (id: string): Row | undefined =>
    db.prepare("SELECT id, name, layout, updated_at FROM dashboards WHERE id = ?").get(id) as Row | undefined;

  /** The flagged row, or the first by position when none is (a restored older backup). */
  const homeId = (): string | undefined =>
    (
      db.prepare("SELECT id FROM dashboards ORDER BY home DESC, position, rowid LIMIT 1").get() as
        | { id: string }
        | undefined
    )?.id;

  const nameTaken = (name: string, except?: string): boolean =>
    db.prepare("SELECT 1 FROM dashboards WHERE lower(name) = lower(?) AND id IS NOT ?").get(name, except ?? null) !==
    undefined;

  const count = (): number => (db.prepare("SELECT COUNT(*) AS n FROM dashboards").get() as { n: number }).n;

  function resolve(stored: Row): Dashboard {
    const base = { id: stored.id, name: stored.name, home: stored.id === homeId(), updatedAt: stored.updated_at };
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

  function insert(name: string, layout: string | null): Dashboard {
    const base = slugOf(name);
    let id = base;
    for (let n = 2; row(id) !== undefined; n++) id = `${base}-${n}`;
    const { next } = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM dashboards").get() as {
      next: number;
    };
    db.prepare("INSERT INTO dashboards (id, name, layout, updated_at, position, home) VALUES (?, ?, ?, ?, ?, 0)").run(
      id,
      name,
      layout,
      new Date().toISOString(),
      next,
    );
    return resolve(row(id) as Row);
  }

  return {
    list(): DashboardSummary[] {
      const home = homeId();
      return (
        db.prepare("SELECT id, name, layout, updated_at FROM dashboards ORDER BY position, rowid").all() as unknown as Row[]
      ).map((stored) => ({
        id: stored.id,
        name: stored.name,
        // A summary does not parse the layout; an unreadable one still reads
        // as customised here, and the dashboard itself says why when opened.
        isDefault: stored.layout === null,
        home: stored.id === home,
        updatedAt: stored.updated_at,
      }));
    },

    /** `layout` null follows the default in code, as a never-customised Overview does. */
    create(name: string, layout: DashboardLayout | null): CreateResult {
      if (count() >= MAX_DASHBOARDS) return { kind: "full" };
      if (nameTaken(name)) return { kind: "name-taken" };
      return { kind: "created", dashboard: insert(name, layout === null ? null : JSON.stringify(layout)) };
    },

    /**
     * A file shared by someone else names what it was called there; a clash
     * here is not the importer's mistake, so the copy is numbered instead.
     */
    import(file: DashboardExport): CreateResult {
      if (count() >= MAX_DASHBOARDS) return { kind: "full" };
      let name = file.name;
      for (let n = 2; nameTaken(name); n++) {
        const suffix = ` (${n})`;
        name = `${file.name.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
      }
      return { kind: "created", dashboard: insert(name, JSON.stringify(file.layout)) };
    },

    export(id: string): DashboardExport | undefined {
      const stored = row(id);
      if (stored === undefined) return undefined;
      const { name, layout } = resolve(stored);
      return { format: "isitdown.dashboard", version: 1, name, layout };
    },

    /**
     * Name and home are not the layout, so neither moves `updatedAt`: a rename
     * in one tab must not turn an edit open in another into a conflict.
     */
    update(id: string, change: { name?: string | undefined; home?: true | undefined }): UpdateResult {
      if (row(id) === undefined) return undefined;
      if (change.name !== undefined && nameTaken(change.name, id)) return { kind: "name-taken" };
      db.exec("BEGIN");
      try {
        if (change.name !== undefined) db.prepare("UPDATE dashboards SET name = ? WHERE id = ?").run(change.name, id);
        if (change.home === true) db.prepare("UPDATE dashboards SET home = (id = ?)").run(id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return { kind: "updated", dashboard: resolve(row(id) as Row) };
    },

    /** The last one stays: the Overview always has something to open. Home moves to the first left. */
    remove(id: string): RemoveResult {
      const stored = row(id);
      if (stored === undefined) return undefined;
      if (count() <= 1) return { kind: "last" };
      const wasHome = homeId() === id;
      const { position } = db.prepare("SELECT position FROM dashboards WHERE id = ?").get(id) as { position: number };
      db.prepare("DELETE FROM dashboards WHERE id = ?").run(id);
      if (wasHome) {
        const next = homeId();
        if (next !== undefined) db.prepare("UPDATE dashboards SET home = (id = ?)").run(next);
      }
      return { kind: "removed", removed: { id, name: stored.name, layout: stored.layout, position, home: wasHome } };
    },

    /**
     * Undo of a delete: the same id, so a bookmark to it works again, the same
     * place in the rail and, if it was home, home again. The layout goes back
     * byte for byte — an unreadable one stays unreadable rather than being
     * quietly replaced by the default.
     */
    restore(removed: RemovedDashboard): RestoreResult {
      if (row(removed.id) !== undefined) return { kind: "id-taken" };
      if (count() >= MAX_DASHBOARDS) return { kind: "full" };
      if (nameTaken(removed.name)) return { kind: "name-taken" };
      db.exec("BEGIN");
      try {
        db.prepare("UPDATE dashboards SET position = position + 1 WHERE position >= ?").run(removed.position);
        db.prepare("INSERT INTO dashboards (id, name, layout, updated_at, position, home) VALUES (?, ?, ?, ?, ?, 0)").run(
          removed.id,
          removed.name,
          removed.layout,
          new Date().toISOString(),
          removed.position,
        );
        if (removed.home) db.prepare("UPDATE dashboards SET home = (id = ?)").run(removed.id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return { kind: "created", dashboard: resolve(row(removed.id) as Row) };
    },

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
