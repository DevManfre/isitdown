import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NumberTicker, tickerDuration } from "./number-ticker";

// The suite runs with the reduced-motion preference reported as set
// (vitest.setup.ts), which is the state where the ticker paints its target
// instead of springing to it — so these read the figure an operator ends up
// looking at, not a frame of the count.
describe("NumberTicker", () => {
  it("formats the value in the locale it is given, not en-US", () => {
    render(<NumberTicker locale="it" value={12345.5} decimalPlaces={2} />);
    expect(screen.getByText("12.345,50")).toBeInTheDocument();
  });

  it("keeps the suffix in the same text node the spring writes to", () => {
    render(<NumberTicker locale="en" value={99.9} decimalPlaces={2} suffix="%" />);
    expect(screen.getByText("99.90%")).toBeInTheDocument();
  });

  it("counts whole numbers without a fraction by default", () => {
    render(<NumberTicker locale="en" value={7} />);
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("gives a higher figure a shorter run than a lower one", () => {
    expect(tickerDuration(8500)).toBeLessThan(tickerDuration(99));
    expect(tickerDuration(99)).toBeLessThan(tickerDuration(7));
    expect(tickerDuration(7)).toBeLessThan(tickerDuration(0));
  });

  it("keeps even the extremes inside one run of the animation", () => {
    expect(tickerDuration(0)).toBeCloseTo(1.4);
    expect(tickerDuration(1_000_000)).toBeCloseTo(0.5);
  });

  it("times a negative figure by its size, not its sign", () => {
    expect(tickerDuration(-99)).toBe(tickerDuration(99));
  });

  it("follows a value that changes under it", () => {
    const { rerender } = render(<NumberTicker locale="en" value={3} />);
    rerender(<NumberTicker locale="en" value={5} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});
