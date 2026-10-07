import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusDot } from "./StatusDot.tsx";

describe("StatusDot", () => {
  it("draws a declared status as a solid fill", () => {
    const { container } = render(<StatusDot status="major_outage" />);
    const dot = container.querySelector("[data-status]") as HTMLElement;
    expect(dot.dataset["suspected"]).toBeUndefined();
  });

  it("draws a suspected status hatched, in the same status colour", () => {
    const { container } = render(<StatusDot status="major_outage" hatched />);
    const dot = container.querySelector("[data-status='major_outage']") as HTMLElement;
    // The stripes themselves are a `color-mix` gradient jsdom cannot parse, so
    // the semantic hook is what is asserted; the real render is checked in a
    // browser.
    expect(dot.dataset["suspected"]).toBe("true");
  });
});
