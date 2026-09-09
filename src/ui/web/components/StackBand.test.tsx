import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { Overview } from "@/views/Overview.tsx";

/**
 * Roadmap 2.6. The band answers "is my deploy path healthy", which the flat
 * fleet under it never could.
 */
const providers = [
  providerFixture({ id: "github", name: "GitHub", overallStatus: "operational" }),
  providerFixture({ id: "vercel", name: "Vercel", overallStatus: "partial_outage" }),
];

const base = {
  status: {
    providers,
    pollIntervalMinutes: 5,
    lastPollAt: null,
    nextPollAt: null,
    groups: [
      { id: "deploy-path", providers: ["github", "vercel"], status: "partial_outage", affected: ["vercel"] },
    ],
  },
  history: { aggregateUptime: 99, aggregateDelta: null, dailyUptime: [], months: [], providers: [] },
};

describe("the stack band", () => {
  it("shows the group's own status and names the member behind it", async () => {
    renderWithProviders(<Overview />, base);

    const band = within(await screen.findByRole("region", { name: i18n.t("stack.title") }));
    expect(band.getByText("deploy-path")).toBeInTheDocument();
    // The status word, not just a colour: the composite has to be readable.
    // Upper-cased by CSS, so the DOM still carries the translated string.
    expect(band.getByText(i18n.t("status.partial-outage"))).toBeInTheDocument();
    expect(band.getByText(/Vercel/)).toBeInTheDocument();
  });

  it("says a healthy group is healthy, with how many providers that covers", async () => {
    renderWithProviders(<Overview />, {
      ...base,
      status: {
        ...base.status,
        groups: [{ id: "billing", providers: ["github", "vercel"], status: "operational", affected: [] }],
      },
    });

    const band = within(await screen.findByRole("region", { name: i18n.t("stack.title") }));
    expect(band.getByText(i18n.t("stack.all-well", { count: 2 }))).toBeInTheDocument();
  });

  it("renders nothing at all while nothing is grouped", async () => {
    renderWithProviders(<Overview />, { ...base, status: { ...base.status, groups: [] } });

    // The fleet still renders; the band does not exist rather than sitting
    // there empty as a promise.
    expect(await screen.findAllByText("GitHub")).not.toHaveLength(0);
    expect(screen.queryByRole("region", { name: i18n.t("stack.title") })).toBeNull();
  });
});
