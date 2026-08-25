import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { Incidents } from "./Incidents.tsx";

const incidents = {
  active: [{ providerId: "github", incidentId: "i1", name: "API errors", impact: "major",
             status: "investigating", startedAt: "2026-08-21T09:00:00Z",
             updatedAt: "2026-08-21T09:30:00Z", resolvedAt: null }],
  closed: [{ providerId: "github", incidentId: "i0", name: "Old blip", impact: "minor",
             status: "resolved", startedAt: "2026-08-01T09:00:00Z",
             updatedAt: "2026-08-01T10:00:00Z", resolvedAt: "2026-08-01T10:00:00Z" }],
};
const fixtures = {
  incidents,
  status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
  notifications: { notifications: [] },
};

afterEach(() => {
  vi.unstubAllGlobals();
  // The view persists the chosen filter to localStorage (isitdown.incidentFilter),
  // same convention as the rail and theme hooks — clear it so one test's click
  // doesn't leak into the next test's initial render.
  localStorage.clear();
});

describe("Incidents", () => {
  it("lists an active incident and a closed one under the all filter", async () => {
    renderWithProviders(<Incidents />, fixtures);
    expect(await screen.findByText("API errors")).toBeInTheDocument();
    expect(await screen.findByText("Old blip")).toBeInTheDocument();
  });

  it("hides closed incidents under the active filter", async () => {
    renderWithProviders(<Incidents />, fixtures);
    await userEvent.click(await screen.findByRole("radio", { name: i18n.t("filter.active") }));
    expect(screen.queryByText("Old blip")).toBeNull();
    expect(screen.getByText("API errors")).toBeInTheDocument();
  });

  it("hides active incidents under the resolved filter", async () => {
    renderWithProviders(<Incidents />, fixtures);
    await userEvent.click(await screen.findByRole("radio", { name: i18n.t("filter.resolved") }));
    expect(screen.queryByText("API errors")).toBeNull();
    expect(screen.getByText("Old blip")).toBeInTheDocument();
  });

  it("keeps a keyed empty state per section rather than a blank panel", async () => {
    renderWithProviders(<Incidents />, { ...fixtures, incidents: { active: [], closed: [] } });
    expect(await screen.findByText(i18n.t("incidents.empty-active"))).toBeInTheDocument();
    expect(await screen.findByText(i18n.t("incidents.empty-closed"))).toBeInTheDocument();
  });

  it("names the provider, not just its id", async () => {
    renderWithProviders(<Incidents />, fixtures);
    expect(await screen.findAllByText(/GitHub/)).not.toHaveLength(0);
  });

  it("shows the notifications-sent empty state when nothing was sent", async () => {
    renderWithProviders(<Incidents />, fixtures);
    expect(await screen.findByText(i18n.t("incidents.empty-notifications"))).toBeInTheDocument();
  });
});
