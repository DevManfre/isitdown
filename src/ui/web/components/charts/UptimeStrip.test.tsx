import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UptimeStrip } from "./UptimeStrip.tsx";
import type { HistoryBucket, OverallStatus } from "@/lib/types.ts";

const buckets = (...statuses: OverallStatus[]): HistoryBucket[] =>
  statuses.map((status, index) => ({ day: `2026-08-${String(index + 1).padStart(2, "0")}`, status }));

/** The bars, in the order they are drawn — oldest first, as the API sends them. */
const bars = (container: HTMLElement): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>("[data-status]")];

describe("UptimeStrip", () => {
  it("draws one bar per day", () => {
    const { container } = render(<UptimeStrip buckets={buckets("operational", "degraded", "unknown")} />);
    expect(bars(container)).toHaveLength(3);
  });

  it("keeps the days in the order they arrived, so the strip reads oldest first", () => {
    const { container } = render(<UptimeStrip buckets={buckets("operational", "major_outage")} />);
    expect(bars(container).map((bar) => bar.dataset.status)).toEqual(["operational", "major_outage"]);
  });

  // The colour itself is not asserted here: a bar's background is a custom
  // property reference, and jsdom's CSSOM drops a declaration it cannot
  // resolve, so it never reaches `style.background`. That is why a bar carries
  // `data-status` at all — the same reason StatusDot does. Which token each
  // status maps to is chartConfig's own contract, covered in
  // chartConfig.test.ts.

  // A day nobody measured must not read as loud as a day that was down.
  it("mutes a never-measured day and leaves a measured one at full strength", () => {
    const { container } = render(<UptimeStrip buckets={buckets("unknown", "operational")} />);
    const [never, measured] = bars(container);
    expect(never).toHaveStyle({ opacity: "0.45" });
    expect(measured).toHaveStyle({ opacity: "1" });
  });

  it("draws nothing at all for a provider with no history yet", () => {
    const { container } = render(<UptimeStrip buckets={[]} />);
    expect(bars(container)).toHaveLength(0);
  });
});
