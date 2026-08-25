import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHashRouter, RouterProvider } from "react-router";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { RailProvider } from "@/hooks/useRail.tsx";
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

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createHashRouter([{ path: "/", element: <Rail /> }]);
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RailProvider>
          <RouterProvider router={router} />
        </RailProvider>
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
  localStorage.clear();
  document.documentElement.removeAttribute("data-rail");
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

  it("collapses and stamps the attribute the pre-paint script reads", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("nav.rail-collapse") }));
    expect(document.documentElement.getAttribute("data-rail")).toBe("collapsed");
    expect(localStorage.getItem("isitdown.railCollapsed")).toBe("true");
  });

  it("relabels the toggle when collapsed", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("nav.rail-collapse") }));
    expect(await screen.findByRole("button", { name: i18n.t("nav.rail-expand") })).toBeInTheDocument();
  });

  it("shows one dot per configured channel", async () => {
    mount();
    expect(await screen.findByText("telegram")).toBeInTheDocument();
  });
});
