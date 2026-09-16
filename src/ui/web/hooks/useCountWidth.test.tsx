import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCountWidth } from "./useCountWidth.ts";

describe("useCountWidth", () => {
  it("reserves one character per digit of the figure it is given", () => {
    const { result } = renderHook(() => useCountWidth(7));
    expect(result.current).toBe("1ch");
  });

  it("widens when the figure grows a digit", () => {
    const { result, rerender } = renderHook(({ value }) => useCountWidth(value), { initialProps: { value: 9 } });
    act(() => rerender({ value: 232 }));
    expect(result.current).toBe("3ch");
  });

  // The whole point: a narrower window must not pull the row back in, or the
  // controls beside the counts slide sideways every time the window changes.
  it("never narrows again once a wider figure has been shown", () => {
    const { result, rerender } = renderHook(({ value }) => useCountWidth(value), { initialProps: { value: 232 } });
    act(() => rerender({ value: 4 }));
    expect(result.current).toBe("3ch");
  });

  it("holds a single character for an empty tally rather than collapsing", () => {
    const { result } = renderHook(() => useCountWidth(0));
    expect(result.current).toBe("1ch");
  });
});
