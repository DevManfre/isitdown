import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHashRouter, RouterProvider } from "react-router";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { ThemeProvider } from "@/hooks/useTheme.tsx";
import { MobileNav, openMoreSheet } from "./MobileNav.tsx";

const status = {
  providers: [
    { id: "github", name: "GitHub", enabled: true, overallStatus: "operational", activeIncidents: [], uptime90: 99.9 },
    {
      id: "cf", name: "Cloudflare", enabled: true, overallStatus: "major_outage",
      activeIncidents: [
        { id: "i1", name: "down", impact: "major", status: "investigating", updatedAt: "2026-08-21T00:00:00Z" },
        { id: "i2", name: "slow", impact: "minor", status: "identified", updatedAt: "2026-08-21T00:00:00Z" },
      ],
      uptime90: 90,
    },
    // Disabled, and carrying an incident nothing will ever resolve: the badge
    // must not count it, the way the rail's own badge does not.
    {
      id: "slack", name: "Slack", enabled: false, overallStatus: "major_outage",
      activeIncidents: [{ id: "i3", name: "stale", impact: "major", status: "investigating", updatedAt: "2026-08-21T00:00:00Z" }],
      uptime90: 80,
    },
  ],
  pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null,
};
const config = { polling: {}, services: [], channels: [{ id: "telegram", enabled: true, fields: [] }] };

function mount(path = "/overview") {
  window.location.hash = `#${path}`;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createHashRouter([{ path: "*", element: <MobileNav /> }]);
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true, status: 200,
    text: async () => JSON.stringify(url.includes("/config") ? config : status),
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("MobileNav", () => {
  it("shows a tab for the four views an operator moves between", async () => {
    mount();
    for (const label of ["nav.overview", "nav.providers", "nav.incidents", "nav.history"]) {
      expect(await screen.findByText(i18n.t(label))).toBeInTheDocument();
    }
    expect(screen.getByText(i18n.t("nav.more"))).toBeInTheDocument();
  });

  it("badges the incidents tab with the open incidents of enabled providers only", async () => {
    mount();
    expect(await screen.findByText("2")).toBeInTheDocument();
  });

  it("puts the views that have no tab behind the More sheet", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: i18n.t("nav.more") }));
    expect(await screen.findByText(i18n.t("nav.settings"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("nav.delivery-log"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("palette.open"))).toBeInTheDocument();
  });

  it("opens the same sheet from the header's own button", async () => {
    mount();
    // The header is a sibling in `App`, so it asks through the event rather
    // than through a lifted state — the same contract the palette has.
    openMoreSheet();
    expect(await screen.findByText(i18n.t("nav.theme"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("nav.language"))).toBeInTheDocument();
  });

  it("names every theme instead of cycling through them", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: i18n.t("nav.more") }));
    const dark = await screen.findByRole("button", { name: i18n.t("theme.dark") });
    await user.click(dark);
    expect(dark).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
