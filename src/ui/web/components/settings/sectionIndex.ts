/**
 * What Settings is made of, as data: one entry per category tile, and the rows
 * that category holds.
 *
 * The page is a launcher now — the grid shows categories, and the rows live on
 * the category's own route — so a search field over the grid has nothing
 * rendered to read. `rowKeys` is what it searches instead: the same catalog
 * keys the rows themselves are labelled with, so a hit says "Polling cadence,
 * in Engine" and the click lands on the row.
 *
 * It is a second list of those keys, and a row added without being named here
 * is a row the search cannot find. `settingIndex.test.ts` holds it to what it
 * can check — that every key resolves in the English catalog — and the rest is
 * a rule to keep: a new `SettingRow` gets its label key added to its section
 * here in the same edit.
 */
export interface SettingsCategory {
  id: string;
  labelKey: string;
  blurbKey: string;
  /** Catalog keys of the rows this category holds, in the order they appear. */
  rowKeys: string[];
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: "engine",
    labelKey: "settings.section.engine",
    blurbKey: "settings.section.engine.blurb",
    rowKeys: [
      "field.interval",
      "field.timeout",
      "field.adaptive",
      "field.adaptive-interval",
      "field.confirm-samples",
      "field.retries",
    ],
  },
  {
    id: "services",
    labelKey: "settings.section.services",
    blurbKey: "settings.section.services.blurb",
    rowKeys: ["action.add-service", "service.filter.muted", "action.debug-adapter"],
  },
  {
    id: "removed",
    labelKey: "settings.section.removed",
    blurbKey: "settings.section.removed.blurb",
    rowKeys: ["action.restore"],
  },
  {
    id: "notifications",
    labelKey: "settings.section.notifications",
    blurbKey: "settings.section.notifications.blurb",
    rowKeys: ["settings.routing", "channel.env-var-toggle", "channel.locale", "channel.template"],
  },
  {
    id: "delivery",
    labelKey: "settings.section.delivery",
    blurbKey: "settings.section.delivery.blurb",
    rowKeys: [
      "field.quiet-hours",
      "field.digest",
      "field.digest.window",
      "field.digest.floor",
      "field.cap",
      "field.cap.max",
      "field.update-in-place",
    ],
  },
  {
    id: "data",
    labelKey: "settings.section.data",
    blurbKey: "settings.section.data.blurb",
    rowKeys: [
      "field.retention",
      "settings.maintenance.label",
      "settings.backup.label",
      "settings.backup.import",
      "settings.restore.label",
    ],
  },
  {
    id: "appearance",
    labelKey: "settings.section.appearance",
    blurbKey: "settings.section.appearance.blurb",
    rowKeys: ["settings.timezone.label", "settings.map-view.label"],
  },
];

/** The category a Settings URL is showing, or `undefined` for the launcher. */
export function openCategory(pathname: string): string | undefined {
  const match = /^\/settings\/([a-z-]+)\/?$/.exec(pathname);
  const id = match?.[1];
  return SETTINGS_CATEGORIES.some((category) => category.id === id) ? id : undefined;
}
