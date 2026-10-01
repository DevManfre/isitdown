import { act, render, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { useStatus } from "@/hooks/queries.ts";
import { createQueryClient } from "@/lib/queryClient.ts";
import { ViewFrame } from "./ViewFrame.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A view that wants data, like every real one. */
function Child() {
  useStatus();
  return <p>the view</p>;
}

/** One client per mount, kept so a rerender can stay under the same one. */
function mount(ui: ReactElement) {
  const client = createQueryClient({ retry: false });
  const view = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return {
    ...view,
    remount: (next: ReactElement) =>
      view.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>),
  };
}

/** A `/status` that does not answer until the test lets it. */
function deferredFetch(): { answer: () => void } {
  let release = (): void => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ok: true, status: 200, text: async () => JSON.stringify({ providers: [] }) };
    }),
  );
  return { answer: () => release() };
}

describe("ViewFrame", () => {
  // The whole point of the gate: `data-animate` is what starts every entry
  // animation in motion.css, so a view that stamps it before its data exists
  // plays its cascade against an empty page and then plays a second one when
  // the rows arrive. That is the stutter this replaces.
  it("withholds the cascade until the view's first data has landed", async () => {
    const status = deferredFetch();
    const { container } = mount(
      <ViewFrame view="overview">
        <Child />
      </ViewFrame>,
    );
    const view = container.querySelector("#view");

    expect(view).not.toHaveAttribute("data-animate");

    await act(async () => {
      status.answer();
    });
    await waitFor(() => expect(view).toHaveAttribute("data-animate", "overview"));
  });

  it("animates straight away when the view asks for nothing", async () => {
    deferredFetch();
    const { container } = mount(<ViewFrame view="settings">nothing to fetch</ViewFrame>);

    await waitFor(() =>
      expect(container.querySelector("#view")).toHaveAttribute("data-animate", "settings"),
    );
  });

  // SEM-224/SEM-275: the fixed `pb-24` this used to carry could sit short of
  // the tab bar's real rendered height (row content + its safe-area inset),
  // which is what let the bar cover the last row on a device with a home
  // indicator. The replacement has to scale with both quantities instead of
  // guessing a number independent of either, and it has to stay off above
  // 768px, where the bar is hidden and `md:pb-6` already covers the gutter.
  it("reserves exactly the tab bar's own height plus its safe area below 768px", () => {
    const { container } = mount(<ViewFrame view="settings">nothing to fetch</ViewFrame>);
    const view = container.querySelector("#view");

    expect(view?.className).toMatch(
      /pb-\[calc\(var\(--mobile-nav-height\)_\+_env\(safe-area-inset-bottom\)_\+_1px\)\]/,
    );
    expect(view?.className).not.toMatch(/\bpb-24\b/);
    expect(view?.className).toContain("md:pb-6");
  });

  // The preference seed changes the theme and the locale, both of which are in
  // `viewKey`, so it remounts the view. Cascading before it lands means
  // cascading twice: once in the default theme, once in the operator's.
  it("keeps holding while something outside the view is still settling", async () => {
    const status = deferredFetch();
    const { container, remount } = mount(
      <ViewFrame view="overview" hold>
        <Child />
      </ViewFrame>,
    );
    const view = container.querySelector("#view");

    await act(async () => {
      status.answer();
    });
    expect(view).not.toHaveAttribute("data-animate");

    remount(
      <ViewFrame view="overview">
        <Child />
      </ViewFrame>,
    );
    await waitFor(() => expect(view).toHaveAttribute("data-animate", "overview"));
  });

  // A request that never comes back must cost a slow page, not a blank one.
  it("shows the view anyway once the hold cap runs out", async () => {
    vi.useFakeTimers();
    deferredFetch();
    const { container } = mount(
      <ViewFrame view="overview">
        <Child />
      </ViewFrame>,
    );
    const view = container.querySelector("#view");
    expect(view).not.toHaveAttribute("data-animate");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(view).toHaveAttribute("data-animate", "overview");
  });
});
