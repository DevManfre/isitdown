import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness.tsx";
import { Header } from "./Header.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("Header", () => {
  // No test elsewhere asserts this against anything but t() itself, which
  // passes even when theme.mode's {mode} placeholder goes unfilled — the bug
  // class Task 8 actually found here (a raw "{mode} mode" reaching the page).
  it("labels the theme button with the resolved copy, not a raw placeholder", async () => {
    localStorage.setItem("isitdown.theme", "dark");
    renderWithProviders(<Header view="overview" />, {
      status: { providers: [], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
    });
    expect(await screen.findByRole("button", { name: "Dark mode" })).toBeInTheDocument();
  });
});
