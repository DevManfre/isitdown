/**
 * The dashboard's route table.
 *
 * Routing is hash-based: `#/incidents/github/i1`. Path-based routing is not
 * available — `/incidents/:providerId/:incidentId` is already an API endpoint,
 * so a path router would have the server answer every deep link with JSON.
 */
export const ROUTE_PATHS = {
  overview: "/overview",
  providers: "/providers",
  /**
   * One provider, linkable — roadmap 5.6. `#/providers/github` is the page an
   * operator can send to somebody or keep in a tab; the drawer beside the lists
   * stays the one-click look, not the only way in.
   */
  providerDetail: "/providers/:providerId",
  incidents: "/incidents",
  incidentDetail: "/incidents/:providerId/:incidentId",
  history: "/history",
  deliveryLog: "/delivery-log",
  settings: "/settings",
  /** One Settings category, on its own page: `#/settings/engine`. */
  settingsSection: "/settings/:sectionId",
} as const;

export type RouteName = keyof typeof ROUTE_PATHS;

/** Every route that is a destination in its own right — the rail's own set. */
export type NavRouteName = Exclude<RouteName, "settingsSection" | "providerDetail">;

/** The rail's order, which is also the nav-label lookup order. */
export const NAV_ROUTES: { name: NavRouteName; labelKey: string }[] = [
  { name: "overview", labelKey: "nav.overview" },
  { name: "providers", labelKey: "nav.providers" },
  { name: "incidents", labelKey: "nav.incidents" },
  { name: "history", labelKey: "nav.history" },
  { name: "deliveryLog", labelKey: "nav.delivery-log" },
  { name: "settings", labelKey: "nav.settings" },
];
