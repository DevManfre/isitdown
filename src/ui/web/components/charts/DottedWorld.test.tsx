import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { DottedWorld } from "./DottedWorld.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import i18n from "@/lib/i18n.ts";
import { tierFill } from "@/lib/chartConfig.ts";
import type { MapCell } from "@/lib/mapCells.ts";
import type { MapPoint } from "@/lib/types.ts";

/**
 * `Tooltip` here is a bare Radix `Root` (components/ui/tooltip.tsx) with no
 * self-wrapped provider, and the shared `renderWithProviders` harness does not
 * supply one. In production `GeoCard` wraps the card; in isolation the test
 * must.
 *
 * The real `i18n` singleton (not renderWithProviders, which this component
 * doesn't need the rest of) is wrapped explicitly too: nothing else in this
 * file imports `@/lib/i18n.ts`, and without it `useTranslation()` has no
 * catalog to resolve against and every `t()` call renders its raw key — the
 * same instance UptimeRing.test.tsx and the shared harness already use.
 */
const Wrap = ({ children }: { children: ReactNode }) => (
  <I18nextProvider i18n={i18n}>
    <TooltipProvider>{children}</TooltipProvider>
  </I18nextProvider>
);

const point = (name: string, status: MapPoint["status"] = "operational"): MapPoint => ({
  providerId: "cloudflare",
  providerName: "Cloudflare",
  componentId: name,
  name,
  lat: 52.31,
  lon: 4.76,
  status,
  source: "iata",
});

const cell = (overrides: Partial<MapCell> = {}): MapCell => ({
  lat: 52.31,
  lon: 4.76,
  count: 1,
  worst: "operational",
  points: [point("Amsterdam, Netherlands - (AMS)")],
  ...overrides,
});

describe("DottedWorld", () => {
  it("draws the base grid", () => {
    render(
      <Wrap>
        <DottedWorld cells={[]} onSelect={() => {}} />
      </Wrap>,
    );
    expect(screen.getByTestId("dotted-world-base").children.length).toBeGreaterThan(500);
  });

  it("draws one marker per cell", () => {
    render(
      <Wrap>
        <DottedWorld cells={[cell(), cell({ lat: -33.87, lon: 151.21 })]} onSelect={() => {}} />
      </Wrap>,
    );
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("names the cell's locations in its accessible label", () => {
    render(
      <Wrap>
        <DottedWorld cells={[cell()]} onSelect={() => {}} />
      </Wrap>,
    );
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("Amsterdam");
  });

  it("calls onSelect with the clicked cell", async () => {
    const onSelect = vi.fn();
    const target = cell({ count: 3 });
    render(
      <Wrap>
        <DottedWorld cells={[target]} onSelect={onSelect} />
      </Wrap>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith(target);
  });

  it("gives a cell of many a larger radius than a cell of one", () => {
    render(
      <Wrap>
        <DottedWorld
          cells={[cell({ count: 1 }), cell({ lat: 0, lon: 0, count: 20, worst: "major_outage" })]}
          onSelect={() => {}}
        />
      </Wrap>,
    );
    const radii = screen.getAllByRole("button").map((node) => Number(node.getAttribute("r")));
    const [small, large] = radii;
    expect(large).toBeGreaterThan(small as number);
    // Capped at 5 so a marker never spans more than about half a 4° cell —
    // above that, neighbouring cells fuse and a fault is swallowed.
    expect(Math.max(...radii)).toBeLessThanOrEqual(5);
  });

  it("takes every marker colour from the fill token, never the text token or a literal", () => {
    render(
      <Wrap>
        <DottedWorld cells={[cell({ worst: "major_outage" })]} onSelect={() => {}} />
      </Wrap>,
    );
    // `toMatch(/^var\(--/)` alone passes for tierColor(tier) just as much as
    // tierFill(tier) — both resolve to a var(--...) string. Pin the exact
    // -fill token so swapping tierFill for tierColor (the regression this
    // constraint exists to catch) actually fails here.
    expect(screen.getByRole("button").getAttribute("fill")).toBe(tierFill("danger"));
  });

  it("rings a fault cell and leaves an operational one unringed", () => {
    const { container } = render(
      <Wrap>
        <DottedWorld cells={[cell({ worst: "major_outage" })]} onSelect={() => {}} />
      </Wrap>,
    );
    const rings = container.querySelectorAll("circle[stroke]");
    expect(rings).toHaveLength(1);
    // Same gap as the marker-fill test: presence alone doesn't rule out
    // tierColor(tier) or a literal on the ring's stroke.
    expect(rings[0]?.getAttribute("stroke")).toBe(tierFill("danger"));

    const plain = render(
      <Wrap>
        <DottedWorld cells={[cell({ worst: "operational" })]} onSelect={() => {}} />
      </Wrap>,
    );
    expect(plain.container.querySelectorAll("circle[stroke]")).toHaveLength(0);
  });

  it("draws a fault cell after an operational one, whatever order it arrives in", () => {
    // Draw order, not input order: at 4° the European cells overlap, and a
    // fault painted under its operational neighbour is a fault nobody sees.
    // The two cells need distinguishable locations — reusing the default
    // Amsterdam point on both would make the last label "Amsterdam"
    // regardless of whether the sort ran at all.
    render(
      <Wrap>
        <DottedWorld
          cells={[
            cell({ worst: "major_outage" }),
            cell({
              lat: 51.5,
              lon: -0.1,
              worst: "operational",
              points: [point("London, United Kingdom - (LHR)")],
            }),
          ]}
          onSelect={() => {}}
        />
      </Wrap>,
    );
    const labels = screen.getAllByRole("button").map((node) => node.getAttribute("aria-label") ?? "");
    expect(labels.at(-1)).toContain("Amsterdam");
  });
});
