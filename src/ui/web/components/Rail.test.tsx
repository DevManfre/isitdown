import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHashRouter, RouterProvider } from "react-router";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { SidebarProvider } from "@/components/ui/sidebar.tsx";
import { Rail } from "./Rail.tsx";

const status = {
  providers: [
    { id: "github", name: "GitHub", overallStatus: "operational", activeIncidents: [], uptime90: 99.9 },
    { id: "cf", name: "Cloudflare", overallStatus: "major_outage",
      activeIncidents: [{ id: "i1", name: "down", impact: "major", status: "investigating", updatedAt: "2026-08-21T00:00:00Z" }],
      uptime90: 90 },
  ],
  pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null,
};
const config = { polling: {}, services: [], channels: [{ id: "telegram", enabled: true, fields: [] }] };

// The rail is a `Sidebar`, so it needs the primitive's context — mounted the
// way App mounts it, with `open` pinned true, since that pin is what leaves the
// rail with no collapsed state to reach.
function Shell() {
  return (
    <SidebarProvider className="console" open>
      <Rail />
    </SidebarProvider>
  );
}

function mount(path = "/") {
  window.location.hash = `#${path}`;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createHashRouter([{ path: "*", element: <Shell /> }]);
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
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

describe("Rail", () => {
  it("links every nav route", async () => {
    mount();
    for (const label of ["nav.overview", "nav.providers", "nav.incidents", "nav.history", "nav.settings"]) {
      expect(await screen.findByText(i18n.t(label))).toBeInTheDocument();
    }
  });

  it("badges the provider count and the open-incident count", async () => {
    mount();
    expect(await screen.findByText("2")).toBeInTheDocument();  // providers
    expect(await screen.findByText("1")).toBeInTheDocument();  // open incidents
  });

  // The rail is pinned open, so it carries no control of its own: every
  // interactive thing in it is a nav link. A button back in here is the pin
  // returning, and with it a collapsed state nothing is styled for any more.
  it("renders no collapse control", async () => {
    mount();
    await screen.findByText(i18n.t("nav.overview"));
    expect(screen.queryByRole("button")).toBeNull();
  });

  // `asChild` hands the row to NavLink, which means the primitive can no longer
  // read the active state out of NavLink's render prop — Rail.tsx computes it
  // with `matchPath` instead. The unended match is the part worth pinning: an
  // incident's own page is still the Incidents view.
  it("marks the row for the current view, and keeps it marked on a detail route", async () => {
    mount("/incidents/github/i1");
    expect(await screen.findByRole("link", { name: i18n.t("nav.incidents") }))
      .toHaveAttribute("data-active", "true");
    expect(screen.getByRole("link", { name: i18n.t("nav.overview") }))
      .toHaveAttribute("data-active", "false");
  });

  it("shows one dot per configured channel", async () => {
    mount();
    expect(await screen.findByText("telegram")).toBeInTheDocument();
  });
});
