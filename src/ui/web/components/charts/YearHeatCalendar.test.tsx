import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n.ts";
import { YearHeatCalendar } from "./YearHeatCalendar.tsx";
import type { CalendarDay, OverallStatus } from "@/lib/types.ts";

const DAY_MS = 24 * 3600 * 1000;

/** A year ending on `last`, every day operational unless `overrides` says otherwise. */
function year(last: string, count: number, overrides: Record<string, OverallStatus> = {}): CalendarDay[] {
  const end = Date.parse(`${last}T00:00:00Z`);
  return Array.from({ length: count }, (_unused, index) => {
    const day = new Date(end - (count - 1 - index) * DAY_MS).toISOString().slice(0, 10);
    const status = overrides[day] ?? "operational";
    return { day, status, uptime: status === "unknown" ? null : 100 };
  });
}

/** The day cells, in draw order. A padding slot carries no `data-day`. */
const cells = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>("[data-day]"),
];

describe("YearHeatCalendar", () => {
  it("draws one cell per day and no more", () => {
    const { container } = render(
      <YearHeatCalendar cells={year("2026-09-10", 365)} uptime={99.9} measuredDays={365} heading="Year" />,
    );

    expect(cells(container)).toHaveLength(365);
  });

  it("keeps the days in the order they arrived, oldest first", () => {
    const { container } = render(
      <YearHeatCalendar cells={year("2026-09-10", 30)} uptime={100} measuredDays={30} heading="Year" />,
    );

    const days = cells(container).map((cell) => cell.dataset.day);
    expect(days[0]).toBe("2026-08-12");
    expect(days.at(-1)).toBe("2026-09-10");
  });

  it("colours a day by its worst status, and mutes one nobody measured", () => {
    const { container } = render(
      <YearHeatCalendar
        cells={year("2026-09-10", 3, { "2026-09-09": "major_outage", "2026-09-08": "unknown" })}
        uptime={66.6}
        measuredDays={2}
        heading="Year"
      />,
    );

    const [never, down, up] = cells(container);
    expect(never?.dataset.status).toBe("unknown");
    expect(never).toHaveStyle({ opacity: "0.45" });
    expect(down?.dataset.status).toBe("major_outage");
    expect(up).toHaveStyle({ opacity: "1" });
  });

  it("names the window it covers, since 365 hover targets are not an accessible name", () => {
    render(
      <YearHeatCalendar cells={year("2026-09-10", 365)} uptime={99.42} measuredDays={120} heading="Year" />,
    );

    const grid = screen.getByRole("img", {
      name: i18n.t("history.calendar-summary", { days: 365, measured: 120, uptime: "99.42" }),
    });
    expect(grid).toBeInTheDocument();
  });

  it("says on hover what a day was, and that an unmeasured one has no percentage", () => {
    const { container } = render(
      <YearHeatCalendar
        cells={year("2026-09-10", 2, { "2026-09-09": "unknown" })}
        uptime={100}
        measuredDays={1}
        heading="Year"
      />,
    );

    const [never, measured] = cells(container);
    expect(never?.title).toContain(i18n.t("history.month-no-data"));
    expect(measured?.title).toContain(i18n.t("status.operational"));
  });

  it("draws nothing at all for a provider with no history yet", () => {
    const { container } = render(
      <YearHeatCalendar cells={[]} uptime={0} measuredDays={0} heading="Year" />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
