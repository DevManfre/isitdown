import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
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

  // "not polled yet" is a claim about the server, and before /status answers
  // the dashboard has no grounds for it. It used to be the subtitle for the
  // first second of every visit — and it still would be if the read failed —
  // because `status?.lastPollAt ?? null` collapses "no answer yet" into the
  // same null as "answered, never polled".
  it("says nothing about the last poll while the read has not answered", async () => {
    renderWithProviders(<Header view="overview" />, { errors: { status: 500 } });
    expect(await screen.findByRole("button", { name: /mode$/ })).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("meta.never-polled"))).not.toBeInTheDocument();
  });

  it("says so once the server answers that it has never polled", async () => {
    renderWithProviders(<Header view="overview" />, {
      status: { providers: [], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
    });
    // The countdown beside it says the same words, so the subtitle is asserted
    // by its own element rather than by a text lookup that matches both.
    await waitFor(() =>
      expect(document.querySelector(".header-meta")).toHaveTextContent(i18n.t("meta.never-polled")),
    );
  });

  // data-mode on its own would pass even if all three modes mapped to the same
  // glyph — it is read off the same `mode` the lookup uses. The class lucide
  // stamps on the svg is what proves three different icons actually mount.
  it("swaps the glyph for each mode as the button cycles", async () => {
    localStorage.setItem("isitdown.theme", "light");
    renderWithProviders(<Header view="overview" />, {
      status: { providers: [], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
    });

    const glyphs: string[] = [];
    for (const expected of ["light", "dark", "system"]) {
      const icon = await screen.findByTestId("theme-icon");
      expect(icon).toHaveAttribute("data-mode", expected);
      glyphs.push(icon.getAttribute("class") ?? "");
      await userEvent.click(screen.getByRole("button", { name: /mode$/ }));
    }
    expect(new Set(glyphs).size).toBe(3);
  });
});
