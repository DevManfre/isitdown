import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import { IncidentTimelineCard } from "./IncidentTimelineCard.tsx";

afterEach(() => vi.unstubAllGlobals());

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
