import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnimatedThemeToggler } from "./animated-theme-toggler";

// jsdom answers every media query with `matches: false`, so full motion is the
// default here and the quiet path is the one a test has to ask for.
const wantsReducedMotion = () => {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: true,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
};

afterEach(() => {
  vi.restoreAllMocks();
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  delete document.documentElement.dataset.magicuiThemeVt;
});

describe("AnimatedThemeToggler", () => {
  it("switches the theme where the browser has no view transitions", async () => {
    const onToggle = vi.fn();
    render(<AnimatedThemeToggler onToggle={onToggle}>icon</AnimatedThemeToggler>);

    await userEvent.click(screen.getByRole("button"));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("switches the theme without a reveal when reduced motion is asked for", async () => {
    wantsReducedMotion();
    const startViewTransition = vi.fn();
    (document as { startViewTransition?: unknown }).startViewTransition = startViewTransition;
    const onToggle = vi.fn();
    render(<AnimatedThemeToggler onToggle={onToggle}>icon</AnimatedThemeToggler>);

    await userEvent.click(screen.getByRole("button"));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it("runs the switch inside the transition, so the reveal wipes the new theme on", async () => {
    // The real API snapshots the document around this callback; here it only
    // has to run it, which is what the switch depends on.
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return { finished: Promise.resolve(), ready: Promise.reject(new Error("no reveal")) };
    });
    (document as { startViewTransition?: unknown }).startViewTransition = startViewTransition;
    const onToggle = vi.fn();
    render(<AnimatedThemeToggler onToggle={onToggle}>icon</AnimatedThemeToggler>);

    await userEvent.click(screen.getByRole("button"));

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("ignores a second click while a reveal is still running", async () => {
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      // Never settles: the first reveal is still on screen.
      return { finished: new Promise(() => {}), ready: new Promise(() => {}) };
    });
    (document as { startViewTransition?: unknown }).startViewTransition = startViewTransition;
    const onToggle = vi.fn();
    render(<AnimatedThemeToggler onToggle={onToggle}>icon</AnimatedThemeToggler>);

    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByRole("button"));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("clears the pinned clip when it unmounts mid-reveal", async () => {
    (document as { startViewTransition?: unknown }).startViewTransition = (
      callback: () => void,
    ) => {
      callback();
      return { finished: new Promise(() => {}), ready: new Promise(() => {}) };
    };
    const { unmount } = render(
      <AnimatedThemeToggler onToggle={() => {}}>icon</AnimatedThemeToggler>,
    );

    await userEvent.click(screen.getByRole("button"));
    expect(document.documentElement.dataset.magicuiThemeVt).toBe("active");

    unmount();

    expect(document.documentElement.dataset.magicuiThemeVt).toBeUndefined();
    expect(
      document.documentElement.style.getPropertyValue("--magicui-theme-vt-clip-from"),
    ).toBe("");
  });
});
