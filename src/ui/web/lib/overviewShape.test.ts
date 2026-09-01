import { describe, expect, it } from "vitest";
import { overviewShape } from "./overviewShape.ts";

describe("overviewShape", () => {
  it("keeps the rings beside the copy for a handful of providers", () => {
    expect(overviewShape(1)).toBe("compact");
    expect(overviewShape(6)).toBe("compact");
  });

  it("moves the rings into a full-width band once they no longer fit two rows", () => {
    // Seven is the first count a 3-column ring grid cannot draw in two rows,
    // which is where the hero starts growing instead of the band.
    expect(overviewShape(7)).toBe("band");
    expect(overviewShape(14)).toBe("band");
  });

  it("drops the rings entirely once the band itself would take a third row", () => {
    expect(overviewShape(15)).toBe("dense");
    expect(overviewShape(200)).toBe("dense");
  });

  // The empty fleet has its own copy in the view; the shape only has to be a
  // valid one so nothing downstream branches on undefined.
  it("treats an empty fleet as compact rather than returning nothing", () => {
    expect(overviewShape(0)).toBe("compact");
  });

  // A count is a length, never a fraction — but a caller passing one must not
  // silently land in a different shape than its rounded value.
  it("classifies by whole providers", () => {
    expect(overviewShape(6.5)).toBe("compact");
    expect(overviewShape(14.5)).toBe("band");
  });
});
