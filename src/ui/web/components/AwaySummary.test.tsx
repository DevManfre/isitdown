import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import type { IncidentRow } from "@/lib/types.ts";
import { AwaySummary } from "./AwaySummary.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

const incident = (id: string, startedHoursAgo: number, resolvedHoursAgo: number | null, name: string): IncidentRow => ({
  providerId: "github",
  incidentId: id,
  name,
  impact: "major",
  status: resolvedHoursAgo === null ? "investigating" : "resolved",
  startedAt: ago(startedHoursAgo),
  updatedAt: ago(resolvedHoursAgo ?? startedHoursAgo),
  resolvedAt: resolvedHoursAgo === null ? null : ago(resolvedHoursAgo),
});

const page = (items: IncidentRow[]) => ({
  active: items.filter((row) => row.resolvedAt === null),
  page: { items, page: 1, pageSize: 100, total: items.length },
  counts: { all: items.length, active: 0, resolved: 0 },
});

const base = {
  status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
  maintenances: { maintenances: [] },
  deliveryLog: { page: { items: [], page: 1, pageSize: 200, total: 0 }, counts: { all: 0, sent: 0, failed: 0 } },
};

const prefs = (lastSeenAt: string | null | undefined) => ({
  theme: "system",
  uiLocale: "en",
  notificationLocale: "en",
  mapView: "off",
  density: "comfortable",
  ...(lastSeenAt === undefined ? {} : { lastSeenAt }),
});

/** Every PATCH the summary sent to the preferences, as the body it carried. */
const patches = () =>
  (fetch as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls
    .filter(([path, init]) => String(path).startsWith("/api/preferences") && init?.method === "PATCH")
    .map(([, init]) => JSON.parse(String(init?.body)) as { lastSeenAt?: string });

describe("AwaySummary", () => {
  it("recounts a weekend: what is still open, what resolved, and the alerts sent", async () => {
    renderWithProviders(<AwaySummary />, {
      ...base,
      preferences: prefs(ago(60)),
      incidents: page([incident("i1", 5, null, "API errors"), incident("i2", 30, 29, "Slow pushes"), incident("old", 200, 100, "Long gone")]),
      deliveryLog: {
        page: {
          items: [
            { providerId: "github", channel: "telegram", kind: "incident_opened", text: "x", sentAt: ago(5), ok: true },
            { providerId: "github", channel: "slack", kind: "incident_opened", text: "x", sentAt: ago(5), ok: false },
          ],
          page: 1,
          pageSize: 200,
          total: 2,
        },
        counts: { all: 2, sent: 1, failed: 1 },
      },
    });
    expect(await screen.findByRole("region", { name: i18n.t("away.title") })).toBeInTheDocument();
    expect(screen.getByText(i18n.t("away.open", { count: 1 }))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("away.resolved", { count: 1 }))).toBeInTheDocument();
    expect(screen.getByText(/API errors/)).toBeInTheDocument();
    expect(screen.getByText(/Slow pushes/)).toBeInTheDocument();
    // Started and closed before the last visit: old news, not the recap's.
    expect(screen.queryByText(/Long gone/)).toBeNull();
    expect(screen.getByText(i18n.t("away.failed", { count: 1 }))).toBeInTheDocument();
  });

  it("stores the visit and goes away when the operator says they have seen it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AwaySummary />, {
      ...base,
      preferences: prefs(ago(20)),
      incidents: page([incident("i1", 5, null, "API errors")]),
    });
    await user.click(await screen.findByRole("button", { name: i18n.t("away.seen") }));
    expect(screen.queryByRole("region", { name: i18n.t("away.title") })).toBeNull();
    expect(patches().at(-1)?.lastSeenAt).toBeDefined();
  });

  it("remembers being collapsed, and still says the tally in one line", async () => {
    const user = userEvent.setup();
    const fixtures = { ...base, preferences: prefs(ago(20)), incidents: page([incident("i1", 5, null, "API errors")]) };
    const { unmount } = renderWithProviders(<AwaySummary />, fixtures);
    await user.click(await screen.findByRole("button", { name: i18n.t("away.collapse") }));
    expect(screen.queryByText(/API errors/)).toBeNull();
    unmount();
    renderWithProviders(<AwaySummary />, fixtures);
    expect(await screen.findByRole("button", { name: i18n.t("away.expand") })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(i18n.t("away.tally", { open: 1, resolved: 0, maintenance: 0 }))).toBeInTheDocument();
  });

  it.each([
    ["a first visit", null],
    ["an absence under eight hours", ago(3)],
  ])("draws nothing on %s and quietly moves the visit to now", async (_case, lastSeenAt) => {
    renderWithProviders(<AwaySummary />, { ...base, preferences: prefs(lastSeenAt), incidents: page([incident("i1", 1, null, "API errors")]) });
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(screen.queryByRole("region", { name: i18n.t("away.title") })).toBeNull();
  });

  it("draws nothing when nothing happened, rather than an empty card", async () => {
    renderWithProviders(<AwaySummary />, { ...base, preferences: prefs(ago(48)), incidents: page([]) });
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(screen.queryByRole("region", { name: i18n.t("away.title") })).toBeNull();
  });

  it("stays off, and writes nothing, against a server that predates it", async () => {
    renderWithProviders(<AwaySummary />, { ...base, preferences: prefs(undefined), incidents: page([incident("i1", 5, null, "API errors")]) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(patches()).toHaveLength(0);
    expect(screen.queryByRole("region", { name: i18n.t("away.title") })).toBeNull();
  });
});
