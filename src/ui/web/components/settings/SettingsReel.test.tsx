import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { SettingsReel, type ReelPainter } from "./SettingsReel.tsx";

/**
 * happy-dom has no 2D context, no layout and no rAF clock worth trusting, so
 * all three are stood up here: the point of these tests is *when* the reel
 * paints and with what time, not what the pixels look like — `test:visual`
 * owns the pixels.
 */
const ctx = {
  clearRect: vi.fn(),
  setTransform: vi.fn(),
} as unknown as CanvasRenderingContext2D;

let observers: { callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = [];
let reduced = false;

beforeEach(() => {
  observers = [];
  reduced = false;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as null);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 300,
    height: 100,
  } as DOMRect);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect = vi.fn();
      constructor(public callback: ResizeObserverCallback) {
        observers.push({ callback, disconnect: this.disconnect });
      }
      observe(): void {}
      unobserve(): void {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Drives the rAF clock by hand: `pump(n)` runs n frames, 100ms apart. */
const driveFrames = (): ((frames: number) => void) => {
  let now = 0;
  const queue: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    queue.push(cb);
    return queue.length;
  });
  vi.spyOn(performance, "now").mockImplementation(() => now);
  return (frames: number): void => {
    for (let i = 0; i < frames; i++) {
      const next = queue.shift();
      if (next === undefined) break;
      now += 100;
      act(() => next(now));
    }
  };
};

describe("SettingsReel", () => {
  it("is decoration, and says so to a screen reader", () => {
    const { container } = render(<SettingsReel painter={vi.fn()} className="band" />);
    const band = container.querySelector('[data-slot="settings-reel"]');
    expect(band).toHaveAttribute("aria-hidden", "true");
    expect(band).toHaveClass("band");
    expect(container.querySelector("canvas")).not.toBeNull();
  });

  it("sizes the backing store by the device ratio, capped at 2", () => {
    vi.stubGlobal("devicePixelRatio", 3);
    const { container } = render(<SettingsReel painter={vi.fn()} />);
    const canvas = container.querySelector("canvas");
    expect(canvas?.width).toBe(600);
    expect(canvas?.height).toBe(200);
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  });

  // The whole reason the visual baselines hold: reduced motion paints frame 0
  // exactly once, with no loop behind it to land on a different frame.
  it("paints one still frame under reduced motion", () => {
    reduced = true;
    const painter = vi.fn<ReelPainter>();
    const raf = vi.spyOn(window, "requestAnimationFrame");
    render(<SettingsReel painter={painter} />);
    expect(painter).toHaveBeenCalledTimes(1);
    expect(painter.mock.calls[0]?.[3]).toBe(0);
    expect(raf).not.toHaveBeenCalled();
  });

  // A frame callback carries the timestamp of the frame being composited, which
  // can predate the `performance.now()` the reel started from. A painter reading
  // that as a phase produced a negative alpha, `addColorStop` threw, and the
  // throw took the `requestAnimationFrame` that would have queued the next frame
  // with it — the delivery band was blank for the life of the page.
  it("never hands a painter a negative time, even on a frame stamped before it started", () => {
    const painter = vi.fn<ReelPainter>();
    const queue: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => queue.push(cb));
    vi.spyOn(performance, "now").mockReturnValue(5_000);
    render(<SettingsReel painter={painter} />);

    act(() => queue.shift()?.(4_990));
    act(() => queue.shift()?.(5_100));

    expect(painter).toHaveBeenCalledTimes(2);
    expect(painter.mock.calls[0]?.[3]).toBe(0);
    expect(painter.mock.calls[1]?.[3]).toBeCloseTo(0.1);
  });

  it("loops on seconds elapsed when motion is allowed", () => {
    const painter = vi.fn<ReelPainter>();
    const pump = driveFrames();
    render(<SettingsReel painter={painter} />);
    pump(3);
    const times = painter.mock.calls.map((call) => call[3]);
    expect(times.length).toBeGreaterThan(1);
    expect(times.at(-1)).toBeGreaterThan(0);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("hands the painter the CSS box, not the backing store", () => {
    reduced = true;
    const painter = vi.fn<ReelPainter>();
    vi.stubGlobal("devicePixelRatio", 2);
    render(<SettingsReel painter={painter} />);
    expect(painter.mock.calls[0]?.[1]).toBe(300);
    expect(painter.mock.calls[0]?.[2]).toBe(100);
  });

  it("clears the frame before painting it", () => {
    reduced = true;
    render(<SettingsReel painter={vi.fn()} />);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 300, 100);
  });

  // A resize under reduced motion has no loop to repaint it, so the observer
  // has to: without this the band would stretch its last frame.
  it("repaints on resize while still", () => {
    reduced = true;
    const painter = vi.fn<ReelPainter>();
    render(<SettingsReel painter={painter} />);
    painter.mockClear();
    act(() => observers[0]?.callback([], {} as ResizeObserver));
    expect(painter).toHaveBeenCalledTimes(1);
  });

  it("leaves the running loop to repaint a resize", () => {
    const painter = vi.fn<ReelPainter>();
    const pump = driveFrames();
    render(<SettingsReel painter={painter} />);
    pump(1);
    painter.mockClear();
    act(() => observers[0]?.callback([], {} as ResizeObserver));
    expect(painter).not.toHaveBeenCalled();
  });

  it("stops the loop and the observer when it unmounts", () => {
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const pump = driveFrames();
    const { unmount } = render(<SettingsReel painter={vi.fn()} />);
    pump(1);
    unmount();
    expect(cancel).toHaveBeenCalled();
    expect(observers[0]?.disconnect).toHaveBeenCalled();
  });

  it("starts over when it is given another painter", () => {
    reduced = true;
    const first = vi.fn<ReelPainter>();
    const second = vi.fn<ReelPainter>();
    const { rerender } = render(<SettingsReel painter={first} />);
    rerender(<SettingsReel painter={second} />);
    expect(observers[0]?.disconnect).toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
