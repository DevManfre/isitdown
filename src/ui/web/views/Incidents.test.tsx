import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders, stubApi } from "@/test/harness.tsx";
import type { IncidentRow } from "@/lib/types.ts";
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

/**
 * The open incident shows twice by design — once in the hero card, once as a
 * row of the list, which holds every state under the `all` filter. So a
 * query for a row is scoped to the list's own region rather than the page,
 * which would match the hero too.
 */
const list = () => within(screen.getByRole("region", { name: i18n.t("incidents.list") }));

const open: IncidentRow = {
  providerId: "github", incidentId: "i1", name: "API errors", impact: "major",
  status: "investigating", startedAt: "2026-08-21T09:00:00Z",
  updatedAt: "2026-08-21T09:30:00Z", resolvedAt: null,
};
const resolved: IncidentRow = {
  providerId: "github", incidentId: "i0", name: "Old blip", impact: "minor",
  status: "resolved", startedAt: "2026-08-01T09:00:00Z",
  updatedAt: "2026-08-01T10:00:00Z", resolvedAt: "2026-08-01T10:00:00Z",
};

const incidents = {
  active: [open],
  page: { items: [open, resolved], page: 1, pageSize: 20, total: 2 },
  counts: { all: 2, active: 1, resolved: 1 },
};

const fixtures = {
  incidents,
  status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
  notifications: { notifications: [] },
};

/** `count` open rows named "Outage N". */
const manyOpen = (count: number): IncidentRow[] =>
  Array.from({ length: count }, (_unused, index) => ({
    ...open,
    incidentId: `o${index + 1}`,
    name: `Outage ${index + 1}`,
  }));

/** `count` resolved rows named "Blip N", newest first. */
const many = (count: number, from = 1): IncidentRow[] =>
  Array.from({ length: count }, (_unused, index) => ({
    ...resolved,
    incidentId: `r${from + index}`,
    name: `Blip ${from + index}`,
  }));

/**
 * Serves the incident endpoint the way the server does: a page of `total`
 * rows sliced by the request's own `page` and `state`, so a test can click
 * the pager and the filter and see what an operator would.
 */
const pagedIncidents = (rows: IncidentRow[], pageSize = 2) => (path: string) => {
  const query = new URLSearchParams(path.split("?")[1] ?? "");
  const state = query.get("state") ?? "all";
  const page = Number(query.get("page") ?? 1);
  const matching = rows.filter((row) =>
    state === "active" ? row.resolvedAt === null : state === "resolved" ? row.resolvedAt !== null : true,
  );
  return {
    active: rows.filter((row) => row.resolvedAt === null),
    page: {
      items: matching.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: matching.length,
    },
    counts: {
      all: rows.length,
      active: rows.filter((row) => row.resolvedAt === null).length,
      resolved: rows.filter((row) => row.resolvedAt !== null).length,
    },
  };
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
      renderWithProviders(<Incidents />, {
        ...fixtures,
        incidents: { active: [], page: { items: [], page: 1, pageSize: 20, total: 0 }, counts: { all: 0, active: 0, resolved: 0 } },
      });
      expect(await screen.findByText(i18n.t("incidents.empty-active"))).toBeInTheDocument();
      expect(screen.queryByText("API errors")).toBeNull();

      // The server has recorded an incident since the view loaded.
      stubApi(fixtures);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(await screen.findAllByText("API errors")).not.toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists an open incident and a resolved one under the all filter", async () => {
    renderWithProviders(<Incidents />, fixtures);
    expect(await screen.findByText("Old blip")).toBeInTheDocument();
    expect(list().getByText("API errors")).toBeInTheDocument();
    expect(list().getByText("Old blip")).toBeInTheDocument();
  });

  // The timeline is incidents plus declared maintenance windows, merged —
  // but a maintenance window is not an incident, so it must carry its own
  // label rather than borrow the impact/state wording an incident gets.
  it("merges a maintenance window into the list, labelled distinctly from an incident", async () => {
    renderWithProviders(<Incidents />, {
      ...fixtures,
      maintenances: {
        maintenances: [
          {
            id: "mw-1",
            providerId: "github",
            name: "Database upgrade",
            status: "completed",
            startsAt: "2026-08-15T09:00:00Z",
            endsAt: "2026-08-15T11:00:00Z",
            componentIds: [],
            firstSeenAt: "2026-08-15T09:00:00Z",
            lastSeenAt: "2026-08-15T11:05:00Z",
          },
        ],
      },
    });

    expect(await screen.findByText("Database upgrade")).toBeInTheDocument();
    expect(list().getByText(i18n.t("incidents.maintenance.label"))).toBeInTheDocument();
  });

  // useMaintenances() fetches the whole unpaged set, and the pager below only
  // ever counts incidents — so merging maintenance into every page would
  // repeat the same windows on page 2 onward, and could push a page's row
  // count past PAGE_SIZE. Confirmed ruling: maintenance rides along on page 1
  // only.
  it("shows a maintenance window on page 1 but not once the list moves to page 2", async () => {
    renderWithProviders(<Incidents />, {
      ...fixtures,
      incidents: pagedIncidents(many(5)),
      maintenances: {
        maintenances: [
          {
            id: "mw-1",
            providerId: "github",
            name: "Database upgrade",
            status: "completed",
            startsAt: "2026-08-15T09:00:00Z",
            endsAt: "2026-08-15T11:00:00Z",
            componentIds: [],
            firstSeenAt: "2026-08-15T09:00:00Z",
            lastSeenAt: "2026-08-15T11:05:00Z",
          },
        ],
      },
    });

    expect(await screen.findByText("Blip 1")).toBeInTheDocument();
    expect(list().getByText("Database upgrade")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: i18n.t("pagination.next") }));

    expect(await screen.findByText("Blip 3")).toBeInTheDocument();
    expect(list().queryByText("Database upgrade")).toBeNull();
  });

  // Maintenance carries no incident state, so it should ride along under
  // every filter rather than vanish the moment an operator narrows to
  // "active" or "resolved".
  it("keeps the maintenance row visible under every filter", async () => {
    renderWithProviders(<Incidents />, {
      ...fixtures,
      maintenances: {
        maintenances: [
          {
            id: "mw-1",
            providerId: "github",
            name: "Database upgrade",
            status: "completed",
            startsAt: "2026-08-15T09:00:00Z",
            endsAt: "2026-08-15T11:00:00Z",
            componentIds: [],
            firstSeenAt: "2026-08-15T09:00:00Z",
            lastSeenAt: "2026-08-15T11:05:00Z",
          },
        ],
      },
    });

    for (const filter of ["all", "active", "resolved"] as const) {
      await userEvent.click(await screen.findByRole("radio", radioNamed(i18n.t(`filter.${filter}`))));
      expect(
        await list().findByText("Database upgrade"),
        `the ${filter} filter dropped the maintenance row`,
      ).toBeInTheDocument();
    }
  });

  it("asks the server for one state when the filter narrows, and lists only that", async () => {
    renderWithProviders(<Incidents />, { ...fixtures, incidents: pagedIncidents([open, ...many(3)]) });
    await userEvent.click(await screen.findByRole("radio", radioNamed(i18n.t("filter.resolved"))));

    expect(await screen.findByText("Blip 1")).toBeInTheDocument();
    expect(list().queryByText("API errors")).toBeNull();
    // The hero card is the active incident's, so the resolved filter drops it.
    expect(screen.queryByText(i18n.t("incidents.active"))).toBeNull();
  });

  it("counts every state on the pills, not the rows the page happens to hold", async () => {
    renderWithProviders(<Incidents />, { ...fixtures, incidents: pagedIncidents([open, ...many(5)]) });
    // The pills render before the first response lands, showing 0 — wait for a
    // row, so this asserts the loaded counts rather than the empty ones.
    expect(await screen.findByText("Blip 1")).toBeInTheDocument();
    // Six incidents, two per page: a count read off the page would say 2.
    expect(screen.getByRole("radio", radioNamed(i18n.t("filter.all")))).toHaveTextContent("6");
  });

  it("pages the list under every filter, not just the unfiltered one", async () => {
    // Every state has to overflow a page of its own, or a missing pager would
    // only mean "this filter's list is short".
    renderWithProviders(<Incidents />, { ...fixtures, incidents: pagedIncidents([...manyOpen(3), ...many(5)]) });
    expect(await screen.findByRole("navigation", { name: i18n.t("pagination.label") })).toBeInTheDocument();

    for (const filter of ["active", "resolved", "all"] as const) {
      await userEvent.click(screen.getByRole("radio", radioNamed(i18n.t(`filter.${filter}`))));
      expect(
        await screen.findByRole("navigation", { name: i18n.t("pagination.label") }),
        `the ${filter} filter lost its pager`,
      ).toBeInTheDocument();
    }
  });

  it("moves to the next page and renders that page's rows", async () => {
    renderWithProviders(<Incidents />, { ...fixtures, incidents: pagedIncidents(many(5)) });
    expect(await screen.findByText("Blip 1")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: i18n.t("pagination.next") }));

    expect(await screen.findByText("Blip 3")).toBeInTheDocument();
    expect(screen.queryByText("Blip 1")).toBeNull();
  });

  it("goes back to the first page when the filter changes", async () => {
    renderWithProviders(<Incidents />, { ...fixtures, incidents: pagedIncidents(many(5)) });
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("pagination.next") }));
    expect(await screen.findByText("Blip 3")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", radioNamed(i18n.t("filter.resolved"))));

    // Page 2 of the previous filter is not page 2 of this one — an operator
    // switching filters is starting a new list, and page 2 can be past its end.
    expect(await screen.findByText("Blip 1")).toBeInTheDocument();
    expect(screen.queryByText("Blip 3")).toBeNull();
  });

  it("shows no pager when the whole list fits on one page", async () => {
    renderWithProviders(<Incidents />, fixtures);
    expect(await screen.findByText("Old blip")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: i18n.t("pagination.label") })).toBeNull();
  });

  it("keeps a keyed empty state per section rather than a blank panel", async () => {
    renderWithProviders(<Incidents />, {
      ...fixtures,
      incidents: { active: [], page: { items: [], page: 1, pageSize: 20, total: 0 }, counts: { all: 0, active: 0, resolved: 0 } },
    });
    expect(await screen.findByText(i18n.t("incidents.empty-active"))).toBeInTheDocument();
    expect(await screen.findByText(i18n.t("incidents.empty-list"))).toBeInTheDocument();
  });

  it("names the provider, not just its id", async () => {
    renderWithProviders(<Incidents />, fixtures);
    expect(await screen.findAllByText(/GitHub/)).not.toHaveLength(0);
  });

  it("shows the notifications-sent empty state when nothing was sent", async () => {
    renderWithProviders(<Incidents />, fixtures);
    expect(await screen.findByText(i18n.t("incidents.empty-notifications"))).toBeInTheDocument();
  });

  it("shows two notifications, then the rest behind the one CTA", async () => {
    const sent = Array.from({ length: 5 }, (_unused, index) => ({
      providerId: "github",
      channel: "webhook",
      text: `Delivery ${index + 1}`,
      sentAt: `2026-08-21T09:0${index}:00Z`,
      ok: true,
    }));
    renderWithProviders(<Incidents />, { ...fixtures, notifications: { notifications: sent } });

    expect(await screen.findByText("Delivery 1")).toBeInTheDocument();
    expect(screen.getByText("Delivery 2")).toBeInTheDocument();
    expect(screen.queryByText("Delivery 3")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: i18n.t("action.show-more") }));

    expect(await screen.findByText("Delivery 5")).toBeInTheDocument();
    // One CTA only: revealing the rest leaves nothing left to expand.
    expect(screen.queryByRole("button", { name: i18n.t("action.show-more") })).not.toBeInTheDocument();
  });
});
