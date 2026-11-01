import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import type { ProviderStatus } from "@/lib/types.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { IncidentBand, incidentProviders } from "./IncidentBand.tsx";

/** Roadmap 4.22: incident mode on the Overview. */

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const incident = { id: "inc1", name: "Elevated 5xx errors on Workers", impact: "major", status: "identified", updatedAt: "2026-08-21T09:41:00Z" };
const down = providerFixture({ id: "cloudflare", name: "Cloudflare", overallStatus: "major_outage", activeIncidents: [incident] });
const degraded = providerFixture({ id: "github", name: "GitHub", overallStatus: "degraded" });
const detail = {
  incident: { providerId: "cloudflare", incidentId: "inc1", name: incident.name, impact: "major", status: "identified", startedAt: "2026-08-21T09:12:00Z", updatedAt: "2026-08-21T09:41:00Z", resolvedAt: null },
  timeline: [
    { at: "2026-08-21T09:12:00Z", label: "opened", status: "investigating" },
    { at: "2026-08-21T09:41:00Z", label: "observed", status: "identified" },
  ],
  actionLog: [],
  polls: [],
  otherActiveIncidents: [],
  notes: [{ id: 1, body: "traffic moved to us-east", createdAt: "2026-08-21T09:59:00Z" }],
};

describe("incidentProviders", () => {
  it("counts a major outage, never a muted one or one in declared maintenance", () => {
    const muted = { ...down, id: "a", mutedUntil: "2099-01-01T00:00:00Z" };
    const planned: ProviderStatus = {
      ...down,
      id: "b",
      maintenance: { active: [{ id: "m", name: "", status: "in_progress", startsAt: "", endsAt: "", componentIds: [] }], upcoming: [] },
    };
    expect(incidentProviders([down, degraded, muted, planned]).map((p) => p.id)).toEqual(["cloudflare"]);
  });
});

describe("IncidentBand", () => {
  it("says nothing while the fleet has no major outage", () => {
    renderWithProviders(<IncidentBand providers={[degraded]} />, { annotations: { annotations: [] } });
    expect(screen.queryByTestId("incident-band")).not.toBeInTheDocument();
  });

  it("puts the incident, its latest updates and who else is hit on top", async () => {
    renderWithProviders(<IncidentBand providers={[down, degraded]} />, { incident: detail, annotations: { annotations: [] } });
    expect(await screen.findByRole("heading", { name: incident.name })).toBeInTheDocument();
    expect(screen.getByText(i18n.t("incident-mode.also-hitting", { providers: "GitHub (Degraded)" }))).toBeInTheDocument();
    // Newest first, the operator's own note among them.
    expect(await screen.findByText(i18n.t("incident-mode.note", { body: "traffic moved to us-east" }))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: i18n.t("incident-mode.open") })).toHaveAttribute("href", "#/incidents/cloudflare/inc1");
  });

  it("keeps the band — and the view — up when one of its reads fails", async () => {
    renderWithProviders(<IncidentBand providers={[down]} />, { incident: detail, errors: { annotations: 500 } });
    expect(await screen.findByRole("heading", { name: incident.name })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: i18n.t("action.retry") })).not.toBeInTheDocument();
  });

  it("adds a note to the incident from the band", async () => {
    renderWithProviders(<IncidentBand providers={[down]} />, { incident: detail, annotations: { annotations: [] } });
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("incident-mode.add-note") }));
    await userEvent.type(screen.getByRole("textbox", { name: i18n.t("incident.notes.add") }), "rolled back");
    await userEvent.click(screen.getByRole("button", { name: i18n.t("incident.notes.add") }));
    const posted = vi
      .mocked(fetch)
      .mock.calls.find(([path, init]) => String(path).includes("/incidents/cloudflare/inc1/notes") && (init as RequestInit | undefined)?.method === "POST");
    expect(posted).toBeDefined();
  });

  it("asks before throwing a typed note away", async () => {
    renderWithProviders(<IncidentBand providers={[down]} />, { incident: detail, annotations: { annotations: [] } });
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("incident-mode.add-note") }));
    await userEvent.type(screen.getByRole("textbox", { name: i18n.t("incident.notes.add") }), "half a thought");
    await userEvent.click(screen.getByRole("button", { name: i18n.t("action.cancel") }));
    const confirm = await screen.findByRole("dialog", { name: i18n.t("incident-mode.discard.title") });
    // Keeping it gives the draft back untouched.
    await userEvent.click(within(confirm).getByRole("button", { name: i18n.t("action.cancel") }));
    expect(await screen.findByRole("textbox", { name: i18n.t("incident.notes.add") })).toHaveValue("half a thought");
  });

  it("goes back to the normal view for this incident only", async () => {
    const { unmount } = renderWithProviders(<IncidentBand providers={[down]} />, { incident: detail, annotations: { annotations: [] } });
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("incident-mode.dismiss") }));
    expect(screen.queryByTestId("incident-band")).not.toBeInTheDocument();
    unmount();
    // A different incident is a different reason to look.
    const next = { ...down, activeIncidents: [{ ...incident, id: "inc2", name: "DNS failures" }] };
    renderWithProviders(<IncidentBand providers={[next]} />, { incident: detail, annotations: { annotations: [] } });
    expect(await screen.findByRole("heading", { name: "DNS failures" })).toBeInTheDocument();
  });

  it("says how it ended once the outage resolves", async () => {
    const { unmount } = renderWithProviders(<IncidentBand providers={[down]} />, { incident: detail, annotations: { annotations: [] } });
    await screen.findByTestId("incident-band");
    unmount();
    renderWithProviders(<IncidentBand providers={[{ ...down, overallStatus: "operational", activeIncidents: [] }]} />, {
      annotations: { annotations: [] },
    });
    expect(await screen.findByTestId("incident-resolved")).toHaveTextContent(incident.name);
    expect(screen.getByRole("link", { name: i18n.t("incident-mode.post-mortem") })).toHaveAttribute("href", "#/incidents/cloudflare/inc1");
  });
});
