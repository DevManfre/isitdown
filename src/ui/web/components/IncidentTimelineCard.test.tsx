import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import { IncidentTimelineCard } from "./IncidentTimelineCard.tsx";

// Folds shut by default (dashboard-design-direction); these cases are about
// the open card, so they start from an operator who opened it before.
beforeEach(() => localStorage.setItem("isitdown.widget-open.incidents-timeline", "1"));
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const providers = [
  { id: "github", name: "GitHub" },
  { id: "cloudflare", name: "Cloudflare" },
  { id: "quiet", name: "Quiet" },
];
const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();
const row = (providerId: string, incidentId: string, startedHours: number, resolvedHours: number | null) => ({
  providerId,
  incidentId,
  name: `${providerId} outage`,
  impact: "major",
  startedAt: hoursAgo(startedHours),
  resolvedAt: resolvedHours === null ? null : hoursAgo(resolvedHours),
});
const region = () => screen.findByRole("region", { name: i18n.t("timeline.title") });

describe("IncidentTimelineCard — roadmap 4.12", () => {
  it("draws a lane for each provider that had an incident, and none for one that did not", async () => {
    renderWithProviders(<IncidentTimelineCard providers={providers} />, {
      timeline: { days: 30, incidents: [row("github", "a", 30, 20), row("cloudflare", "b", 50, 40)] },
    });
    const card = within(await region());

    expect(await card.findByText("GitHub")).toBeInTheDocument();
    expect(card.getByText("Cloudflare")).toBeInTheDocument();
    expect(card.queryByText("Quiet")).toBeNull();
  });

  it("names each bar with its incident, impact and duration, and links to it", async () => {
    renderWithProviders(<IncidentTimelineCard providers={providers} />, {
      timeline: { days: 30, incidents: [row("github", "a", 30, 20)] },
    });

    const bar = await screen.findByRole("link", { name: /github outage — .*Major/i });
    expect(bar).toHaveAttribute("href", "#/incidents/github/a");
  });

  // WCAG 2.2 target size: a minute-long incident is a sliver of a 30-day axis,
  // and the link around it must still be at least 24px wide.
  it("never makes a bar's link narrower than 24px, however short the incident", async () => {
    renderWithProviders(<IncidentTimelineCard providers={providers} />, {
      timeline: { days: 30, incidents: [row("github", "a", 30, 20)] },
    });

    const bar = await screen.findByRole("link", { name: /github outage — .*Major/i });
    // `min-w-6` is 1.5rem: 24px at the default size.
    expect(bar).toHaveClass("min-w-6", "h-7");
  });

  it("says in words when two providers were down at once", async () => {
    renderWithProviders(<IncidentTimelineCard providers={providers} />, {
      timeline: { days: 30, incidents: [row("github", "a", 30, 20), row("cloudflare", "b", 25, 15)] },
    });
    const card = within(await region());

    expect(await card.findByText(/1 overlap: GitHub and Cloudflare|1 overlap: Cloudflare and GitHub/)).toBeInTheDocument();
  });

  it("says plainly that nothing overlapped, rather than staying silent", async () => {
    renderWithProviders(<IncidentTimelineCard providers={providers} />, {
      timeline: { days: 30, incidents: [row("github", "a", 30, 20), row("cloudflare", "b", 10, 5)] },
    });

    expect(await screen.findByText(i18n.t("timeline.no-overlap"))).toBeInTheDocument();
  });

  it("offers a way on when the window is empty", async () => {
    renderWithProviders(<IncidentTimelineCard providers={providers} />, {});

    expect(await screen.findByText(i18n.t("timeline.empty", { days: 30 }))).toBeInTheDocument();
  });
});

describe("the operator's metric under the timeline — roadmap 6.11", () => {
  const errors = { id: 1, name: "API 5xx rate", unit: "%", source: "prometheus", url: "http://p", query: "up", points: 0, createdAt: hoursAgo(100) };

  it("draws no picker and no lane while no metric is declared", async () => {
    renderWithProviders(<IncidentTimelineCard providers={providers} />, {
      timeline: { days: 30, incidents: [row("github", "a", 30, 20)] },
    });
    await within(await region()).findByText("GitHub");
    expect(screen.queryByRole("combobox", { name: i18n.t("series.picker") })).toBeNull();
    expect(screen.queryByRole("img", { name: i18n.t("series.lane", { name: errors.name }) })).toBeNull();
  });

  it("draws the first metric under the lanes and says when its peak met an incident", async () => {
    renderWithProviders(<IncidentTimelineCard providers={providers} />, {
      timeline: { days: 30, incidents: [row("cloudflare", "b", 30, 20)] },
      operatorSeries: { series: [errors] },
      seriesReading: { series: errors, from: hoursAgo(720), to: hoursAgo(0), points: [{ at: hoursAgo(40), value: 0.4 }, { at: hoursAgo(25), value: 3.9 }] },
    });
    expect(await screen.findByRole("img", { name: i18n.t("series.lane", { name: errors.name }) })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: i18n.t("series.picker") })).toHaveTextContent("API 5xx rate");
    expect(await screen.findByText(/peaked at 3\.9 %.*during Cloudflare's incident “cloudflare outage”/)).toBeInTheDocument();
  });

  it("says plainly when the peak had no incident under it", async () => {
    renderWithProviders(<IncidentTimelineCard providers={providers} />, {
      timeline: { days: 30, incidents: [row("cloudflare", "b", 30, 20)] },
      operatorSeries: { series: [errors] },
      seriesReading: { series: errors, from: hoursAgo(720), to: hoursAgo(0), points: [{ at: hoursAgo(5), value: 2.1 }] },
    });
    expect(await screen.findByText(/peaked at 2\.1 %.*with no provider incident running/)).toBeInTheDocument();
  });

  it("a series that cannot be read says why in its lane, and the Gantt stays", async () => {
    renderWithProviders(<IncidentTimelineCard providers={providers} />, {
      timeline: { days: 30, incidents: [row("cloudflare", "b", 30, 20)] },
      operatorSeries: { series: [errors] },
      errors: { seriesReading: 502 },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 502");
    expect(screen.getByRole("button", { name: i18n.t("action.retry") })).toBeInTheDocument();
    expect(screen.getByText("Cloudflare")).toBeInTheDocument();
  });
});
