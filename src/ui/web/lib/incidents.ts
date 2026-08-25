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
