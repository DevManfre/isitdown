import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { Overview } from "./Overview.tsx";

const history = {
  aggregateUptime: 99.5,
  months: [],
  providers: [{ providerId: "github", buckets: [{ day: "2026-08-20", status: "operational" }] }],
};

afterEach(() => vi.unstubAllGlobals());

describe("Overview", () => {
  it("headlines all-operational when nothing is down", async () => {
    renderWithProviders(<Overview />, {
      status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
      history,
    });
    expect(await screen.findByText(i18n.t("overview.title.all-operational"))).toBeInTheDocument();
  });

  it("uses the singular headline for exactly one provider down", async () => {
    renderWithProviders(<Overview />, {
      status: {
        providers: [providerFixture({ overallStatus: "major_outage" })],
        pollIntervalMinutes: 5,
        lastPollAt: null,
        nextPollAt: null,
      },
      history,
    });
    expect(await screen.findByText(i18n.t("overview.title.down", { count: 1 }))).toBeInTheDocument();
  });

  it("uses the plural headline for several", async () => {
    renderWithProviders(<Overview />, {
      status: {
        providers: [
          providerFixture({ overallStatus: "major_outage" }),
          providerFixture({ id: "cf", name: "Cloudflare", overallStatus: "degraded" }),
        ],
        pollIntervalMinutes: 5,
        lastPollAt: null,
        nextPollAt: null,
      },
      history,
    });
    expect(await screen.findByText(i18n.t("overview.title.down", { count: 2 }))).toBeInTheDocument();
  });

  it("offers an incident-details action only when an incident is open", async () => {
    renderWithProviders(<Overview />, {
      status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
      history,
    });
    await screen.findByText(i18n.t("overview.title.all-operational"));
    expect(screen.queryByRole("button", { name: i18n.t("action.incident-details") })).toBeNull();
  });

  it("links the incident-details action to the provider's first active incident", async () => {
    renderWithProviders(<Overview />, {
      status: {
        providers: [
          providerFixture({
            overallStatus: "major_outage",
            activeIncidents: [
              { id: "i1", name: "Outage", impact: "major", status: "investigating", updatedAt: "2026-08-21T00:00:00Z" },
              { id: "i2", name: "Second", impact: "minor", status: "investigating", updatedAt: "2026-08-21T00:00:00Z" },
            ],
          }),
        ],
        pollIntervalMinutes: 5,
        lastPollAt: null,
        nextPollAt: null,
      },
      history,
    });
    const button = await screen.findByRole("button", { name: i18n.t("action.incident-details") });
    await button.click();
    expect(window.location.hash).toBe("#/incidents/github/i1");
  });

  it("shows the empty state when no provider is configured", async () => {
    renderWithProviders(<Overview />, {
      status: { providers: [], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
      history: { aggregateUptime: 0, months: [], providers: [] },
    });
    expect(await screen.findByText(i18n.t("providers.empty"))).toBeInTheDocument();
  });

  // No test in this suite otherwise asserts rendered copy against anything
  // but t() itself, which passes even when a template's placeholders go
  // unfilled. This pins the actual characters an operator reads.
  it("renders the literal 90-day uptime footer, not a raw placeholder", async () => {
    renderWithProviders(<Overview />, {
      status: { providers: [providerFixture({ uptime90: 99.9 })], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
      history,
    });
    expect(await screen.findByText("99.90% · 90d")).toBeInTheDocument();
  });
});
