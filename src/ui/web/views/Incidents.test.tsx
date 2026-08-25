import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders, stubApi } from "@/test/harness.tsx";
import { Incidents } from "./Incidents.tsx";

/**
 * Matches a filter radio by the START of its accessible name, not an exact
 * match. The pill's decorative count span is aria-hidden (a real a11y
 * improvement — a bare number doesn't belong in a control's spoken name),
 * but this query must not depend on that attribute being present: if it
 * were ever removed, the accessible name would become e.g. "active 2"
 * instead of "active", and an exact-match query would silently stop
 * finding the control.
 */
const radioNamed = (label: string) => ({
  name: (accessibleName: string) => accessibleName.startsWith(label),
});

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
  // The reason `useIncidents` carries a `refetchInterval` at all. Only the
  // status and config queries had one, so an operator sitting on this view
  // watched the rail badge tick to "1 open incident" while the list beside it
  // stayed empty indefinitely — `staleTime` plus `refetchOnWindowFocus` hid it
  // from anyone who left the tab and came back, but not from anyone watching.
  // Nothing here navigates, clicks or remounts: the view is mounted, the clock
  // moves, and the new incident has to appear on its own.
  it("surfaces a new incident on the next poll, with the view still mounted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderWithProviders(<Incidents />, { ...fixtures, incidents: { active: [], closed: [] } });
      expect(await screen.findByText(i18n.t("incidents.empty-active"))).toBeInTheDocument();
      expect(screen.queryByText("API errors")).toBeNull();

      // The server has recorded an incident since the view loaded.
      stubApi(fixtures);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(await screen.findByText("API errors")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists an active incident and a closed one under the all filter", async () => {
    renderWithProviders(<Incidents />, fixtures);
    expect(await screen.findByText("API errors")).toBeInTheDocument();
    expect(await screen.findByText("Old blip")).toBeInTheDocument();
  });

  it("hides closed incidents under the active filter", async () => {
    renderWithProviders(<Incidents />, fixtures);
    await userEvent.click(await screen.findByRole("radio", radioNamed(i18n.t("filter.active"))));
    expect(screen.queryByText("Old blip")).toBeNull();
    expect(screen.getByText("API errors")).toBeInTheDocument();
  });

  it("hides active incidents under the resolved filter", async () => {
    renderWithProviders(<Incidents />, fixtures);
    await userEvent.click(await screen.findByRole("radio", radioNamed(i18n.t("filter.resolved"))));
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
