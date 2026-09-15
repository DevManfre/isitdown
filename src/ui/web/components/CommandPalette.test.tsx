import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import { CommandPalette } from "./CommandPalette.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

const status = {
  pollIntervalMinutes: 5,
  lastPollAt: null,
  nextPollAt: null,
  providers: [
    { id: "github", name: "GitHub", enabled: true, overallStatus: "operational", activeIncidents: [] },
    { id: "retired", name: "Retired thing", enabled: false, overallStatus: "unknown", activeIncidents: [] },
  ],
};

const open = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
  await user.keyboard("{Control>}k{/Control}");
  await screen.findByPlaceholderText(i18n.t("palette.placeholder"));
};

describe("CommandPalette", () => {
  it("opens on Ctrl+K and closes on the same keystroke", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />, { status });

    expect(screen.queryByPlaceholderText(i18n.t("palette.placeholder"))).not.toBeInTheDocument();
    await open(user);

    await user.keyboard("{Control>}k{/Control}");
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(i18n.t("palette.placeholder"))).not.toBeInTheDocument(),
    );
  });

  it("offers every view the rail does", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />, { status });
    await open(user);

    for (const label of ["nav.overview", "nav.providers", "nav.incidents", "nav.history"]) {
      expect(await screen.findByRole("option", { name: i18n.t(label) })).toBeInTheDocument();
    }
  });

  // The fleet the palette jumps around is the one the views list: a disabled
  // provider is not polled and has no drawer worth opening.
  it("lists the enabled providers and leaves a disabled one out", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />, { status });
    await open(user);

    expect(await screen.findByRole("option", { name: "GitHub" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Retired thing" })).not.toBeInTheDocument();
  });

  it("finds a provider by the id it was configured with, not only by its name", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />, { status });
    await open(user);

    await user.type(screen.getByPlaceholderText(i18n.t("palette.placeholder")), "github");

    expect(await screen.findByRole("option", { name: "GitHub" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: i18n.t("nav.overview") })).not.toBeInTheDocument();
  });

  it("says so rather than showing an empty list when nothing matches", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />, { status });
    await open(user);

    await user.type(screen.getByPlaceholderText(i18n.t("palette.placeholder")), "zzzzz");

    expect(await screen.findByText(i18n.t("palette.empty"))).toBeInTheDocument();
  });

  it("running a poll asks the server and closes the palette", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />, { status });
    await open(user);

    await user.click(await screen.findByRole("option", { name: i18n.t("action.poll-now") }));

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      expect(calls.some((call) => String(call[0]).startsWith("/poll"))).toBe(true);
    });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(i18n.t("palette.placeholder"))).not.toBeInTheDocument(),
    );
  });

  it("changing the theme stamps the next mode on the document", async () => {
    localStorage.setItem("isitdown.theme", "light");
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />, { status });
    await open(user);

    await user.click(await screen.findByRole("option", { name: i18n.t("palette.cycle-theme") }));

    await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).not.toBe("light"));
  });

  // With no answer from /status the palette still has to open: it is mounted in
  // the shell, and a failed chrome read must not take a keystroke away.
  it("opens with its views and actions when the status read failed", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />, { errors: { status: 500 } });
    await open(user);

    expect(await screen.findByRole("option", { name: i18n.t("action.poll-now") })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: i18n.t("nav.overview") })).toBeInTheDocument();
  });
});
