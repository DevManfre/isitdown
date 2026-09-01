import { describe, expect, it } from "vitest";
import { viewKey } from "./App.tsx";

describe("viewKey", () => {
  it("changes when the view changes", () => {
    expect(viewKey("overview", "", "en", "dark")).not.toBe(viewKey("history", "", "en", "dark"));
  });

  it("changes when the route parameters change", () => {
    expect(viewKey("incident", "github/i1", "en", "dark"))
      .not.toBe(viewKey("incident", "github/i2", "en", "dark"));
  });

  it("changes when the locale changes", () => {
    expect(viewKey("overview", "", "en", "dark")).not.toBe(viewKey("overview", "", "it", "dark"));
  });

  it("changes when the theme changes", () => {
    expect(viewKey("overview", "", "en", "dark")).not.toBe(viewKey("overview", "", "en", "light"));
  });

  it("is stable for the same view, params, locale and theme", () => {
    expect(viewKey("overview", "", "en", "dark")).toBe(viewKey("overview", "", "en", "dark"));
  });
});
