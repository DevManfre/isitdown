import type { DeliveryPolicy } from "@/lib/types.ts";

/**
 * What a server from before the delivery policy existed answers with, and what
 * every field means when nothing has been configured: all of it off.
 */
export const DELIVERY_OFF: DeliveryPolicy = {
  quietHours: {
    enabled: false,
    start: "23:00",
    end: "07:00",
    timeZone: "auto",
    minSeverity: "major_outage",
  },
  digest: { enabled: false, windowMinutes: 15, immediateFloor: "major_outage" },
  cap: { enabled: false, maxPerHour: 10 },
  updateInPlace: false,
  maintenanceNotice: { enabled: false, leadMinutes: 120 },
  escalation: { enabled: false, afterMinutes: 15, channel: "", minSeverity: "major_outage" },
  channelHealth: { enabled: false, afterFailures: 3 },
  incidentSummary: { enabled: false },
  coalesce: { enabled: false, windowMinutes: 2 },
  knownOutage: { enabled: false },
  report: { enabled: false, frequency: "weekly", channel: "" },
  attachChart: false,
};
