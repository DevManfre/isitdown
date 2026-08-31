import { statusColor, statusFill } from "./chartConfig.ts";
import type { OverallStatus } from "./types.ts";

/** src/ui/public/js/views/incidents.js — impact word -> severity model. */
const IMPACT: Record<string, OverallStatus> = {
  none: "operational",
  minor: "degraded",
  major: "partial_outage",
  critical: "major_outage",
};

const IMPACT_KEYS: Record<string, string> = {
  none: "impact.none",
  minor: "impact.minor",
  major: "impact.major",
  critical: "impact.critical",
};

/** The lifecycle the stepper on the incident-detail view walks through. */
export const INCIDENT_STEPS = ["investigating", "identified", "monitoring", "resolved"] as const;

const STATUS_KEYS: Record<string, string> = {
  investigating: "incident.status.investigating",
  identified: "incident.status.identified",
  monitoring: "incident.status.monitoring",
  resolved: "incident.status.resolved",
  postmortem: "incident.status.postmortem",
};

export const impactStatus = (impact: string): OverallStatus => IMPACT[impact] ?? "unknown";

export const impactKey = (impact: string): string => IMPACT_KEYS[impact] ?? "status.unknown";

export const impactColor = (impact: string): string => statusColor(impactStatus(impact));

export const impactFill = (impact: string): string => statusFill(impactStatus(impact));

export const incidentStatusKey = (status: string): string => STATUS_KEYS[status] ?? "status.unknown";

/** A gap in the pager stands for pages it does not list. */
export type PageSlot = number | "gap";

/** Beyond this many pages the pager elides the middle instead of listing it. */
const PAGES_SHOWN_IN_FULL = 7;

/**
 * Which page numbers the pager renders: always the first, the last and the
 * current page's immediate neighbours, with a gap standing in for the rest.
 *
 * A gap covering exactly one page is expanded to that page instead — an
 * ellipsis is no shorter than the number it replaces, and hiding a page an
 * operator can see the shape of reads as a bug.
 */
export function pageWindow(current: number, pages: number): PageSlot[] {
  if (pages <= PAGES_SHOWN_IN_FULL) return Array.from({ length: pages }, (_unused, index) => index + 1);

  const kept = new Set([1, pages, current - 1, current, current + 1]);
  const slots: PageSlot[] = [];
  for (let page = 1; page <= pages; page += 1) {
    if (!kept.has(page)) continue;
    const previous = slots.at(-1);
    if (typeof previous === "number" && page - previous === 2) slots.push(previous + 1);
    else if (typeof previous === "number" && page - previous > 2) slots.push("gap");
    slots.push(page);
  }
  return slots;
}
