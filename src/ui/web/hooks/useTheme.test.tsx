import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "./useTheme.tsx";

function Probe() {
  const { mode, cycle } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <button onClick={cycle}>cycle</button>
    </div>
  );
}

const mount = () => render(<ThemeProvider><Probe /></ThemeProvider>);
const mode = () => screen.getByTestId("mode").textContent;
const attr = () => document.documentElement.getAttribute("data-theme");

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
});

describe("useTheme", () => {
  it("starts on system and stamps no attribute", () => {
    mount();
    expect(mode()).toBe("system");
    expect(attr()).toBeNull();
  });

  it("cycles light, dark, system", () => {
    mount();
    act(() => screen.getByText("cycle").click());
    expect(mode()).toBe("light");
    expect(attr()).toBe("light");
    act(() => screen.getByText("cycle").click());
    expect(mode()).toBe("dark");
    expect(attr()).toBe("dark");
    act(() => screen.getByText("cycle").click());
    expect(mode()).toBe("system");
    expect(attr()).toBeNull();
  });

  it("remembers the choice for the pre-paint script", () => {
    mount();
    act(() => screen.getByText("cycle").click());
    expect(localStorage.getItem("isitdown.theme")).toBe("light");
  });

  it("restores a stored choice on mount", () => {
    localStorage.setItem("isitdown.theme", "dark");
    mount();
    expect(mode()).toBe("dark");
    expect(attr()).toBe("dark");
  });
});
