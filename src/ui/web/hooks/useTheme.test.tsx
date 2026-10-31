import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "./useTheme.tsx";

function Probe() {
  const { mode, cycle, set } = useTheme();
  const [returned, setReturned] = useState<string | null>(null);
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="returned">{returned}</span>
      <button onClick={() => setReturned(cycle())}>cycle</button>
      <button onClick={() => set("oled")}>pick oled</button>
      <button onClick={() => set("contrast")}>pick contrast</button>
      <button onClick={() => set("colorblind")}>pick colorblind</button>
    </div>
  );
}

const mount = () => render(<ThemeProvider><Probe /></ThemeProvider>);
const mode = () => screen.getByTestId("mode").textContent;
const returned = () => screen.getByTestId("returned").textContent;
const attr = () => document.documentElement.getAttribute("data-theme");
const variant = () => document.documentElement.getAttribute("data-variant");

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-variant");
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

  it("cycle() returns the mode it switches to, not just void", () => {
    mount();
    act(() => screen.getByText("cycle").click());
    expect(returned()).toBe(mode());
    expect(returned()).toBe("light");
  });

  // Roadmap 4.18: a variant is a ground plus a correction, never a ground of
  // its own — Tailwind's `dark:` and the globe read the ground.
  it.each([
    ["pick oled", "oled", "dark"],
    ["pick contrast", "contrast", "light"],
    ["pick colorblind", "colorblind", "light"],
  ])("%s stamps its variant over the ground it is built on", (button, name, ground) => {
    mount();
    act(() => screen.getByText(button).click());
    expect(mode()).toBe(name);
    expect(attr()).toBe(ground);
    expect(variant()).toBe(name);
  });

  it("drops the variant when the next mode is not one", () => {
    mount();
    act(() => screen.getByText("pick oled").click());
    act(() => screen.getByText("cycle").click());
    expect(variant()).toBeNull();
  });

  it("restarts the header cycle at light when it is pressed on a variant", () => {
    localStorage.setItem("isitdown.theme", "contrast");
    mount();
    act(() => screen.getByText("cycle").click());
    expect(mode()).toBe("light");
    expect(variant()).toBeNull();
  });
});
