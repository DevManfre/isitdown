import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { IncidentDetail } from "./IncidentDetail.tsx";

const detail = {
  incident: { providerId: "github", incidentId: "i1", name: "API errors", impact: "major",
              status: "monitoring", startedAt: "2026-08-21T09:00:00Z",
              updatedAt: "2026-08-21T09:30:00Z", resolvedAt: null },
  timeline: [
    { at: "2026-08-21T09:00:00Z", label: "opened", status: "investigating" },
    { at: "2026-08-21T09:15:00Z", label: "observed", status: "major_outage" },
  ],
  // Field names follow the real SentRecord (lib/types.ts), not a guess:
  // `channel` (not channelId), `text` (not title), `sentAt` (not at), `ok` (not delivered).
  actionLog: [{ providerId: "github", channel: "telegram", kind: "incident_opened" as const,
                text: "GitHub — MAJOR OUTAGE", sentAt: "2026-08-21T09:01:00Z", ok: true }],
  polls: [{ observedAt: "2026-08-21T09:20:00Z", overallStatus: "major_outage" as const, ok: true }],
  otherActiveIncidents: [],
  // Roadmap 5.3: the operator's own account of the incident, which the detail
  // payload carries beside the two IsItDown writes itself.
  notes: [{ id: 1, body: "Our deploy failed on this.", createdAt: "2026-08-21T09:05:00Z" }],
};

const mount = () =>
  renderWithProviders(<IncidentDetail />, {
    incident: detail,
    status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
  }, "/incidents/:providerId/:incidentId");

/** The same fixture, plus the map snapshot and the preference that reveals it. */
const mountWithMap = () =>
  renderWithProviders(<IncidentDetail />, {
    incident: detail,
    status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
    map: {
      points: [{ providerId: "github", providerName: "GitHub", componentId: "github/api",
                 name: "Ashburn", lat: 39.02, lon: -77.46, status: "operational", source: "iata" }],
      unlocated: [],
      generatedAt: "2026-08-21T09:30:00Z",
    },
    preferences: { theme: "dark", uiLocale: "en", notificationLocale: "en", mapView: "map" },
  }, "/incidents/:providerId/:incidentId");

/** Same fixture, with actionLog swapped out — for the empty-state case. */
const mountWithActionLog = (actionLog: typeof detail.actionLog) =>
  renderWithProviders(<IncidentDetail />, {
    incident: { ...detail, actionLog },
    status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
  }, "/incidents/:providerId/:incidentId");

afterEach(() => vi.unstubAllGlobals());

describe("IncidentDetail", () => {
  it("titles the incident and names its provider", async () => {
    mount();
    expect(await screen.findByText("API errors")).toBeInTheDocument();
    expect(await screen.findAllByText(/GitHub/)).not.toHaveLength(0);
  });

  it("marks the stepper at the incident's current lifecycle word", async () => {
    mount();
    // Scoped to the element that actually carries aria-current: the status
    // meta row below (incident.js:214-221) renders the identical catalog
    // word in its own span, so an unscoped text query would find both and
    // throw "multiple elements". Scoping by selector is the fix, not
    // reshaping the row to avoid the collision.
    const step = await screen.findByText(i18n.t("incident.status.monitoring"), {
      selector: '[aria-current="step"]',
    });
    expect(step).toHaveAttribute("aria-current", "step");
  });

  it("renders the status meta row as two elements, matching vanilla's service-row", async () => {
    mount();
    const kicker = await screen.findByText(i18n.t("column.status"));
    // Located through the tile that carries the kicker, not by DOM adjacency
    // to it: the bento wraps every kicker in the tile's own header row
    // (BentoTile.tsx), so `nextElementSibling` is that header's end, not the
    // row. What this test is about is the row's *shape*, below — the way it is
    // found is scaffolding.
    const tile = kicker.closest('[data-slot="card"]');
    const row = tile?.querySelector(".service-row");
    if (!(row instanceof HTMLElement)) throw new Error("expected a status row inside the status tile");
    // Exactly two children: a bare status span and a "mono muted" timestamp
    // span (incident.js:217-220) — not one span carrying both, whatever
    // separator joins them.
    expect(row.children).toHaveLength(2);
    const status = row.children.item(0);
    const timestamp = row.children.item(1);
    if (status === null || timestamp === null) throw new Error("expected two children in the status row");
    expect(status).toHaveTextContent(i18n.t("incident.status.monitoring"));
    expect(timestamp).not.toHaveTextContent(i18n.t("incident.status.monitoring"));
    expect(timestamp).not.toBe(status);
  });

  it("labels every timeline entry from the catalog, in the active language, not a raw label", async () => {
    // en.json's incident.timeline.opened/observed are coincidentally
    // identical to the raw internal label ("opened"/"observed"), so an
    // English-only assertion here cannot tell t() apart from an unwired
    // literal. it.json differs ("aperto"/"osservato") — switch to it for
    // this one assertion so the catalog value and the raw label diverge and
    // the assertion has something to detect.
    await i18n.changeLanguage("it");
    try {
      mount();
      expect(await screen.findByText(i18n.getFixedT("it")("incident.timeline.opened"))).toBeInTheDocument();
      expect(await screen.findByText(i18n.getFixedT("it")("incident.timeline.observed"))).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("shows what was actually sent, per channel", async () => {
    mount();
    expect(await screen.findByText("GitHub — MAJOR OUTAGE")).toBeInTheDocument();
    expect(await screen.findByText(/telegram/)).toBeInTheDocument();
  });

  it("shows a first batch of deliveries, then the rest behind the one CTA", async () => {
    // A long-running incident's action log is the tallest thing on this page —
    // 30 rows of it used to set the tile's height before the operator asked
    // for any of them.
    mountWithActionLog(
      Array.from({ length: 12 }, (_unused, index) => ({
        providerId: "github",
        channel: "webhook" as const,
        kind: "incident_opened" as const,
        text: `Delivery ${index + 1}`,
        sentAt: `2026-08-21T09:${String(index).padStart(2, "0")}:00Z`,
        ok: true,
      })) as unknown as typeof detail.actionLog,
    );

    expect(await screen.findByText("Delivery 1")).toBeInTheDocument();
    expect(screen.getByText("Delivery 6")).toBeInTheDocument();
    expect(screen.queryByText("Delivery 7")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: i18n.t("action.show-more") }));

    expect(await screen.findByText("Delivery 12")).toBeInTheDocument();
    // One CTA only: revealing the rest leaves nothing left to expand.
    expect(screen.queryByRole("button", { name: i18n.t("action.show-more") })).not.toBeInTheDocument();
  });

  it("keeps a keyed empty state when nothing has been sent for this incident yet", async () => {
    mountWithActionLog([]);
    expect(await screen.findByText(i18n.t("incidents.empty-notifications"))).toBeInTheDocument();
    expect(screen.queryByText("GitHub — MAJOR OUTAGE")).toBeNull();
  });

  it("keeps a keyed empty state for the provider's other open incidents", async () => {
    mount();
    expect(await screen.findByText(i18n.t("incident.no-other-active"))).toBeInTheDocument();
  });

  it("offers a way back to the list", async () => {
    mount();
    expect(await screen.findByRole("link", { name: i18n.t("action.back") })).toBeInTheDocument();
  });

  it("gives the incident's provider a map tile once the operator has turned the map on", async () => {
    mountWithMap();
    expect(
      await screen.findByText(i18n.t("incident.map.title", { name: "GitHub" })),
    ).toBeInTheDocument();
  });

  it("leaves the map tile out entirely while the preference is off", async () => {
    mount();
    // Awaited on something the view always renders, so the absence below is
    // read after the view has actually rendered rather than before it.
    await screen.findByText("API errors");
    expect(screen.queryByText(i18n.t("incident.map.title", { name: "GitHub" }))).toBeNull();
  });
});

// Roadmap 5.3. The third account of an incident, beside what IsItDown observed
// and what it sent: the one a person writes.
describe("operator notes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the notes already written on this incident", async () => {
    mount();

    expect(await screen.findByText("Our deploy failed on this.")).toBeInTheDocument();
  });

  it("posts a typed note to this incident and clears the draft", async () => {
    mount();
    const field = await screen.findByLabelText(i18n.t("incident.notes.add"));

    const base = globalThis.fetch as typeof fetch;
    const sent: { target: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string, init?: RequestInit) => {
        if (String(target).endsWith("/notes")) {
          sent.push({ target: String(target), body: String(init?.body) });
          return {
            ok: true,
            status: 201,
            text: async () => JSON.stringify({ id: 2, body: "Vendor confirmed", createdAt: "2026-08-21T10:00:00Z" }),
          };
        }
        return base(target, init);
      }),
    );

    await userEvent.type(field, "Vendor confirmed");
    await userEvent.click(screen.getByRole("button", { name: i18n.t("incident.notes.add") }));

    expect(sent).toHaveLength(1);
    // The harness mounts the route *pattern* as the location, so the ids in the
    // url are the pattern's own; what this pins is that the note is posted to
    // the incident the view was opened on, and nowhere else.
    expect(sent[0]?.target.endsWith("/notes")).toBe(true);
    expect(JSON.parse(sent[0]!.body)).toEqual({ body: "Vendor confirmed" });
    expect(field).toHaveValue("");
  });

  it("will not post a note that is only whitespace", async () => {
    mount();
    const field = await screen.findByLabelText(i18n.t("incident.notes.add"));

    await userEvent.type(field, "   ");

    expect(screen.getByRole("button", { name: i18n.t("incident.notes.add") })).toBeDisabled();
  });

  it("removes a note through the incident it was written on", async () => {
    mount();
    const remove = await screen.findByRole("button", { name: i18n.t("incident.notes.remove") });

    const base = globalThis.fetch as typeof fetch;
    const calls: { method: string; target: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string, init?: RequestInit) => {
        if (String(target).includes("/notes/")) {
          calls.push({ method: String(init?.method), target: String(target) });
          return { ok: true, status: 204, text: async () => "" };
        }
        return base(target, init);
      }),
    );

    await userEvent.click(remove);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("DELETE");
    // The note's own id, under the incident it was written on.
    expect(calls[0]?.target.endsWith("/notes/1")).toBe(true);
  });
});
