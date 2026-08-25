import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { Providers } from "./Providers.tsx";

const status = {
  providers: [providerFixture(), providerFixture({ id: "cf", name: "Cloudflare", enabled: false })],
  pollIntervalMinutes: 5,
  lastPollAt: null,
  nextPollAt: null,
};
const history = {
  aggregateUptime: 99,
  months: [],
  providers: [{ providerId: "github", buckets: [], uptime90: 99.9, incidentCount: 2 }],
};

afterEach(() => vi.unstubAllGlobals());

describe("Providers", () => {
  it("renders one row per configured provider", async () => {
    renderWithProviders(<Providers />, { status, history });
    expect(await screen.findByText("GitHub")).toBeInTheDocument();
    expect(await screen.findByText("Cloudflare")).toBeInTheDocument();
  });

  it("is read-only: no edit or remove control lives here", async () => {
    renderWithProviders(<Providers />, { status, history });
    await screen.findByText("GitHub");
    expect(screen.queryByRole("button", { name: i18n.t("action.edit") })).toBeNull();
    expect(screen.queryByRole("button", { name: i18n.t("action.remove") })).toBeNull();
  });

  it("labels every column from the catalog", async () => {
    renderWithProviders(<Providers />, { status, history });
    for (const key of ["column.provider", "column.status", "column.uptime", "column.incidents"]) {
      expect(await screen.findByText(i18n.t(key))).toBeInTheDocument();
    }
  });

  it("shows the empty state with no providers", async () => {
    renderWithProviders(<Providers />, {
      status: { providers: [], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
      history: { aggregateUptime: 0, months: [], providers: [] },
    });
    expect(await screen.findByText(i18n.t("providers.empty"))).toBeInTheDocument();
  });

  it("dims a disabled provider while still listing it", async () => {
    renderWithProviders(<Providers />, { status, history });
    const cloudflare = await screen.findByText("Cloudflare");
    const row = cloudflare.closest("tr");
    expect(row).not.toBeNull();
    expect(row).toHaveClass("opacity-55");
  });

  // No test above asserts rendered copy against anything but t() itself,
  // which passes whether or not a template's placeholders were satisfied.
  // This pins the actual uptime percentage text an operator reads, using a
  // value distinct from the provider fixture's own uptime90 (99.9) so a pass
  // proves the cell reads history's uptime90, not the status one.
  it("renders the literal uptime percentage from history, not the status uptime90", async () => {
    renderWithProviders(<Providers />, {
      status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
      history: {
        aggregateUptime: 87.65,
        months: [],
        providers: [{ providerId: "github", buckets: [], uptime90: 87.65, incidentCount: 0 }],
      },
    });
    expect(await screen.findByText("87.65%")).toBeInTheDocument();
  });
});
