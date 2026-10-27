import { ROUTE_PATHS } from "../../routePaths.ts";

/**
 * The guided tour — roadmap 4.6. Steps are data: a `data-tour` anchor on a real
 * element and the key of one sentence. A step whose anchor is not on the page
 * (a phone with no search button, an Overview with no tiles) is skipped rather
 * than pointing at nothing.
 */
export interface TourStep {
  anchor: string;
  /** The view the anchor lives on, when it is not in the shell. */
  route?: string;
  labelKey: string;
}

export const TOUR_STEPS: TourStep[] = [
  { anchor: "rail", labelKey: "tour.rail" },
  { anchor: "tile", route: ROUTE_PATHS.overview, labelKey: "tour.tile" },
  { anchor: "nav-incidents", labelKey: "tour.incidents" },
  { anchor: "nav-deliveryLog", labelKey: "tour.delivery-log" },
  { anchor: "nav-settings", labelKey: "tour.settings" },
  { anchor: "search", labelKey: "tour.palette" },
];

/** The element a step points at, or null when it is missing or not drawn. */
export function findAnchor(anchor: string): HTMLElement | null {
  const element = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
  if (element === null) return null;
  const { width, height } = element.getBoundingClientRect();
  return width === 0 || height === 0 ? null : element;
}
