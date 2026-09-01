import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { tierColor } from "@/lib/chartConfig.ts";
import { StatusBeacon } from "./StatusBeacon.tsx";

const beacon = () => screen.getByTestId("status-beacon");

describe("StatusBeacon", () => {
  it("draws the tier it was handed", () => {
    render(<StatusBeacon tier="warn" />);
    expect(beacon()).toHaveAttribute("data-tier", "warn");
  });

  it("draws a different mark for each tier, so colour is not the only signal", () => {
    const marks = new Set<string>();
    for (const tier of ["ok", "warn", "danger", "unknown"] as const) {
      const { unmount } = render(<StatusBeacon tier={tier} />);
      marks.add(beacon().querySelector("svg")?.getAttribute("class") ?? "");
      unmount();
    }
    expect(marks.size, "two tiers share an icon").toBe(4);
  });

  it("takes its colour from the status tokens rather than a literal", () => {
    // Read off the style attribute rather than through toHaveStyle: the
    // computed value of a custom property is empty in this environment, so a
    // token would compare equal to nothing at all and the assertion would pass
    // however the colour was written.
    render(<StatusBeacon tier="danger" />);
    expect(beacon().getAttribute("style")).toContain(`color: ${tierColor("danger")}`);
  });

  // A state that is still unfolding moves; a settled one does not need to
  // shout, and "never measured" is not an event at all.
  it("animates the three live tiers and leaves unknown still", () => {
    for (const tier of ["ok", "warn", "danger"] as const) {
      const { unmount } = render(<StatusBeacon tier={tier} />);
      expect(beacon().className, `${tier} does not move`).toMatch(/beacon-(breathe|pulse)/);
      unmount();
    }
    render(<StatusBeacon tier="unknown" />);
    expect(beacon().className).not.toMatch(/beacon-(breathe|pulse)/);
  });

  // The headline sits next to it and already says the same thing in words.
  it("is decorative, so a screen reader is not told the same thing twice", () => {
    render(<StatusBeacon tier="danger" />);
    expect(beacon()).toHaveAttribute("aria-hidden", "true");
  });
});
