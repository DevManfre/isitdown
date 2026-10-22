import type { Width } from "../../dashboardLayout.ts";

/** A width's catalog keys: its full name (labels, announcements) and the glyph on the segmented control. */
export const WIDTH_KEYS: Record<Width, { label: string; short: string }> = {
  full: { label: "dashboard.width.full", short: "dashboard.width.short.full" },
  "two-thirds": { label: "dashboard.width.two-thirds", short: "dashboard.width.short.two-thirds" },
  half: { label: "dashboard.width.half", short: "dashboard.width.short.half" },
  third: { label: "dashboard.width.third", short: "dashboard.width.short.third" },
};

export const widthLabelKey = (width: Width): string => WIDTH_KEYS[width].label;
