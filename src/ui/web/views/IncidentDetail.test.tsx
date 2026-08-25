import { screen } from "@testing-library/react";
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
};

const mount = () =>
  renderWithProviders(<IncidentDetail />, {
    incident: detail,
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
    const row = kicker.nextElementSibling;
    if (!(row instanceof HTMLElement)) throw new Error("expected a status row element next to its kicker");
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

  it("keeps a keyed empty state for the provider's other open incidents", async () => {
    mount();
    expect(await screen.findByText(i18n.t("incident.no-other-active"))).toBeInTheDocument();
  });

  it("offers a way back to the list", async () => {
    mount();
    expect(await screen.findByRole("link", { name: i18n.t("action.back") })).toBeInTheDocument();
  });
});
