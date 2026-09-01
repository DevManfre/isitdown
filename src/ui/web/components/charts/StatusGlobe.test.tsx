import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Profiler, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import i18n from "@/lib/i18n.ts";
import type { MapCell } from "@/lib/mapCells.ts";

const destroy = vi.fn();
const update = vi.fn();
// Typed explicitly rather than inferred from the zero-arg implementation
// below: an untyped `vi.fn(() => ...)` infers a call signature of `()`, which
// makes `createGlobe.mock.calls[0][1]` (the options object cobe was called
// with) a type error later in this file.
const createGlobe = vi.fn<
  (canvas: HTMLCanvasElement, options: Record<string, unknown>) => {
    destroy: () => void;
    update: (state: { phi?: number }) => void;
  }
>(() => ({ destroy, update }));

// happy-dom has no WebGL, so the canvas cannot be exercised here at all. The
// mock is what makes the rest of the component — the overlay, the markers,
// the theme re-initialisation — testable; the canvas itself is covered only
// by the browser check at the end of Task 15.
vi.mock("cobe", () => ({ default: createGlobe }));

const { StatusGlobe } = await import("./StatusGlobe.tsx");

/**
 * `Tooltip` here is a bare Radix `Root` (components/ui/tooltip.tsx) with no
 * self-wrapped provider, and the component calls `useTranslation()`. Same
 * two-provider wrapper `DottedWorld.test.tsx` needs, same reason: in
 * production `GeoCard` supplies both; in isolation the test must.
 */
const Wrap = ({ children }: { children: ReactNode }) => (
  <I18nextProvider i18n={i18n}>
    <TooltipProvider>{children}</TooltipProvider>
  </I18nextProvider>
);

const cell = (overrides: Partial<MapCell> = {}): MapCell => ({
  lat: 52.31,
  lon: 4.76,
  count: 1,
  worst: "operational",
  points: [
    {
      providerId: "cloudflare",
      providerName: "Cloudflare",
      componentId: "c1",
      name: "Amsterdam, Netherlands - (AMS)",
      lat: 52.31,
      lon: 4.76,
      status: "operational",
      source: "iata",
    },
  ],
  ...overrides,
});

describe("StatusGlobe", () => {
  beforeEach(() => {
    createGlobe.mockClear();
    destroy.mockClear();
    update.mockClear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("creates one globe", () => {
    render(
      <Wrap>
        <StatusGlobe cells={[]} onSelect={() => {}} />
      </Wrap>,
    );
    expect(createGlobe).toHaveBeenCalledTimes(1);
  });

  it("destroys the globe on unmount", () => {
    const { unmount } = render(
      <Wrap>
        <StatusGlobe cells={[]} onSelect={() => {}} />
      </Wrap>,
    );
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("re-initialises when the theme changes", async () => {
    render(
      <Wrap>
        <StatusGlobe cells={[]} onSelect={() => {}} />
      </Wrap>,
    );
    expect(createGlobe).toHaveBeenCalledTimes(1);

    // The globe's colours are resolved tokens: the same token name resolves
    // to a different colour per theme, so a theme flip has to rebuild it.
    // Asserting only ">= 1" here would already be satisfied by the mount
    // above and prove nothing about the flip — the real claim is that the
    // *old* globe is torn down and a *second* one takes its place.
    document.documentElement.setAttribute("data-theme", "dark");

    await waitFor(() => expect(createGlobe).toHaveBeenCalledTimes(2));
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("draws a marker only for the cell on the facing hemisphere", () => {
    render(
      <Wrap>
        <StatusGlobe cells={[cell(), cell({ lat: 0, lon: 179 })]} onSelect={() => {}} />
      </Wrap>,
    );
    // At the initial rotation Amsterdam faces the viewer and lon 179 does
    // not: this only holds because back-face culling actually runs — without
    // it both cells would draw and this would read 2.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("takes every marker colour from a token, never a literal", () => {
    render(
      <Wrap>
        <StatusGlobe cells={[cell({ worst: "major_outage" })]} onSelect={() => {}} />
      </Wrap>,
    );
    for (const marker of screen.getAllByRole("button")) {
      expect(marker.getAttribute("fill")).toMatch(/^var\(--/);
    }
  });

  it("calls onSelect when a marker is clicked", async () => {
    const onSelect = vi.fn();
    const target = cell({ count: 3 });
    render(
      <Wrap>
        <StatusGlobe cells={[target]} onSelect={onSelect} />
      </Wrap>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith(target);
  });

  it("caps the aria-label at 6 names, matching the tooltip's own cap", () => {
    // Before this fix the tooltip capped at 6 names but the aria-label did
    // not, so a screen-reader user heard every PoP a sighted one only saw
    // six of.
    const points = Array.from({ length: 8 }, (_, index) => ({
      providerId: "cloudflare",
      providerName: "Cloudflare",
      componentId: `c${index}`,
      name: `PoP ${index}`,
      lat: 52.31,
      lon: 4.76,
      status: "operational" as const,
      source: "iata" as const,
    }));
    render(
      <Wrap>
        <StatusGlobe cells={[cell({ count: 8, points })]} onSelect={() => {}} />
      </Wrap>,
    );
    const label = screen.getByRole("button").getAttribute("aria-label") ?? "";
    for (let index = 0; index < 6; index += 1) expect(label).toContain(`PoP ${index}`);
    expect(label).not.toContain("PoP 6");
    expect(label).not.toContain("PoP 7");
    expect(label).toContain("2 more");
  });

  it("does not set state from the rotation loop, but still drives it", () => {
    // The whole reason the rotation lives in a ref: the requestAnimationFrame
    // loop that calls `globe.update()` runs every animation frame, and a
    // `setState` there would re-render every marker ~60 times a second on a
    // dashboard an operator leaves open all day. Driving that loop 30 times
    // must not produce 30 renders.
    //
    // cobe 2.0.1 has no `onRender` callback for the component to hand a
    // frame-by-frame hook to (see StatusGlobe.tsx) — the component drives its
    // own `requestAnimationFrame` loop instead, so that is what this test
    // pumps. `requestAnimationFrame` is stubbed to queue callbacks rather
    // than fire them on a real clock, so the 30 frames are deterministic
    // instead of racing the test runner's actual animation timing.
    const queue: FrameRequestCallback[] = [];
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        queue.push(callback);
        return queue.length;
      });
    const caf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    // `Profiler` counts commits of this exact subtree. A `renders` counter
    // on a *parent* component would not catch a regression here: React only
    // re-renders the component whose own state changed, never its parent —
    // a rogue `setState` inside `StatusGlobe` would never bump a counter
    // that only increments in the component wrapping it.
    let commits = 0;
    render(
      <Wrap>
        <Profiler
          id="globe"
          onRender={() => {
            commits += 1;
          }}
        >
          <StatusGlobe cells={[cell()]} onSelect={() => {}} />
        </Profiler>
      </Wrap>,
    );

    const before = commits;
    // `act` is required here, not just React-testing hygiene: without it, a
    // stray `setState` inside the loop would schedule a re-render that React
    // only commits on a later tick, after this assertion already ran — the
    // check below would pass whether or not the regression is present.
    // Wrapping in a synchronous `act` forces any such update to flush before
    // `commits` is read, so this is what makes the assertion capable of
    // catching it at all.
    act(() => {
      for (let i = 0; i < 30; i += 1) queue.shift()?.(i);
    });
    expect(commits).toBe(before);
    // It still advanced the canvas's own rotation, through cobe's real API —
    // `update()`, not a fictional per-frame callback.
    expect(update).toHaveBeenCalledTimes(30);
    const lastPhi = (update.mock.calls.at(-1)?.[0] as { phi?: number } | undefined)?.phi;
    expect(lastPhi).toBeGreaterThan(0);

    raf.mockRestore();
    caf.mockRestore();
  });
});
