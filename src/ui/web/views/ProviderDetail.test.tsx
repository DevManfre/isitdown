import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { ProviderDetail } from "./ProviderDetail.tsx";

const history = {
  providerId: "github",
  buckets: [{ day: "2026-08-21", status: "operational", uptime: 100 }],
  uptime7: 99.91,
  uptime30: 99.42,
  uptime90: 99.11,
  sampleCount: 120,
  incidentCount: 1,
  downtimeMinutes: 12,
  dailySeries: [{ day: "2026-08-21", uptime: 100 }],
  previousUptime: null,
};

const incidents = {
  active: [],
  page: {
    items: [
      {
        providerId: "github",
        incidentId: "i1",
        name: "API errors",
        impact: "major",
        status: "resolved",
        startedAt: "2026-08-21T09:00:00Z",
        updatedAt: "2026-08-21T10:00:00Z",
        resolvedAt: "2026-08-21T10:00:00Z",
      },
    ],
    page: 1,
    pageSize: 10,
    total: 1,
  },
  counts: { all: 1, active: 0, resolved: 1 },
};

const mount = (over: Parameters<typeof providerFixture>[0] = {}) =>
  renderWithProviders(
    <ProviderDetail />,
    {
      status: {
        providers: [providerFixture(over)],
        pollIntervalMinutes: 5,
        lastPollAt: null,
        nextPollAt: null,
      },
      history,
      incidents,
    },
    "/providers/:providerId",
    "/providers/github",
  );

afterEach(() => vi.unstubAllGlobals());

describe("ProviderDetail", () => {
  it("names the provider and links out to its own status page", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: "GitHub" })).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: /githubstatus\.com/ });
    expect(link).toHaveAttribute("href", "https://www.githubstatus.com");
  });

  it("shows the same uptime windows the drawer does", async () => {
    mount();
    // The panel is shared with the drawer, so this is the one assertion that
    // says the page is showing history at all rather than an empty frame.
    expect(await screen.findByText(i18n.t("column.range", { days: 30 }))).toBeInTheDocument();
  });

  it("lists the provider's own incidents, each linking to its detail page", async () => {
    mount();
    const incident = await screen.findByRole("link", { name: /API errors/ });
    expect(incident).toHaveAttribute("href", "#/incidents/github/i1");
  });

  it("says so instead of rendering a page about a provider nothing is watching", async () => {
    renderWithProviders(
      <ProviderDetail />,
      {
        status: {
          providers: [providerFixture({ id: "cloudflare", name: "Cloudflare" })],
          pollIntervalMinutes: 5,
          lastPollAt: null,
          nextPollAt: null,
        },
      },
      "/providers/:providerId",
      "/providers/github",
    );
    expect(
      await screen.findByText(i18n.t("provider.unknown", { provider: "github" })),
    ).toBeInTheDocument();
  });
});
