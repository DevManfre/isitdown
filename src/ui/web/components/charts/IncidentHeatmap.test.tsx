import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n.ts";
import { IncidentHeatmap } from "./IncidentHeatmap.tsx";

const empty = (): number[][] =>
  Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

const show = (grid: number[][]) =>
  render(
    <I18nextProvider i18n={i18n}>
      <IncidentHeatmap grid={grid} />
    </I18nextProvider>,
  );

describe("IncidentHeatmap", () => {
  it("says so when nothing happened, rather than drawing an empty grid", () => {
    show(empty());
    expect(screen.getByText(i18n.t("heatmap.empty"))).toBeInTheDocument();
  });

  it("draws one cell per hour of the week, carrying its own count", () => {
    const grid = empty();
    grid[3]![20] = 5;
    const { container } = show(grid);
    const cells = [...container.querySelectorAll<HTMLElement>("[data-count]")];
    expect(cells).toHaveLength(7 * 24);
    // Thursday at 20:00, the fourth row's twenty-first cell.
    expect(cells[3 * 24 + 20]?.dataset.count).toBe("5");
  });
});
