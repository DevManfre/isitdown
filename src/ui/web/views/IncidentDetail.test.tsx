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
    const step = await screen.findByText(i18n.t("incident.status.monitoring"));
    expect(step).toHaveAttribute("aria-current", "step");
  });

  it("labels every timeline entry from the catalog, never a raw label", async () => {
    mount();
    expect(await screen.findByText(i18n.t("incident.timeline.opened"))).toBeInTheDocument();
    expect(await screen.findByText(i18n.t("incident.timeline.observed"))).toBeInTheDocument();
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
