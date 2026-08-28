import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Profiler, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import i18n from "@/lib/i18n.ts";
import type { MapCell } from "@/lib/mapCells.ts";

const destroy = vi.fn();
// Typed explicitly rather than inferred from the zero-arg implementation
// below: an untyped `vi.fn(() => ...)` infers a call signature of `()`, which
// makes `createGlobe.mock.calls[0][1]` (the options object cobe was called
// with) a type error later in this file. cobe's own `COBEOptions` omits
// `onRender` (see `StatusGlobe.tsx`), so this mirrors it with the one field
// the tests actually read off the mock's captured call.
const createGlobe = vi.fn<
  (canvas: HTMLCanvasElement, options: { onRender?: (state: Record<string, number>) => void }) => {
    destroy: () => void;
  }
>(() => ({ destroy }));

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

  it("does not set state from cobe's per-frame callback", () => {
    // The whole reason the rotation lives in a ref: `onRender` fires every
    // animation frame, and a `setState` there would re-render every marker
    // ~60 times a second on a dashboard an operator leaves open all day.
    // Driving `onRender` 30 times must not produce 30 renders.
    //
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

    const onRender = createGlobe.mock.calls[0]?.[1]?.onRender;
    expect(onRender).toBeTypeOf("function");

    const before = commits;
    const state: Record<string, number> = {};
    // `act` is required here, not just React-testing hygiene: without it, a
    // stray `setState` inside `onRender` would schedule a re-render that
    // React only commits on a later tick, after this assertion already ran
    // — the check below would pass whether or not the regression is present.
    // Wrapping in a synchronous `act` forces any such update to flush before
    // `commits` is read, so this is what makes the assertion capable of
    // catching it at all.
    act(() => {
      for (let i = 0; i < 30; i += 1) onRender?.(state);
    });
    expect(commits).toBe(before);
    // It still advanced the canvas's own rotation.
    expect(state["phi"]).toBeGreaterThan(0);
  });
});
