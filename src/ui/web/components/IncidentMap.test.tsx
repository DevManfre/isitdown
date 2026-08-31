import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import { IncidentMap } from "./IncidentMap.tsx";
import type { MapResponse, Preferences } from "@/lib/types.ts";

const point = (providerId: string, name: string, lat: number, lon: number) => ({
  providerId,
  providerName: providerId,
  componentId: `${providerId}/${name}`,
  name,
  lat,
  lon,
  status: "operational" as const,
  source: "iata" as const,
});

const map = (over: Partial<MapResponse> = {}): MapResponse => ({
  points: [point("github", "Ashburn", 39.02, -77.46), point("cloudflare", "Amsterdam", 52.31, 4.76)],
  unlocated: [],
  generatedAt: "2026-08-21T09:30:00Z",
  ...over,
});

const mount = (mapView: Preferences["mapView"], mapResponse: MapResponse = map()) =>
  renderWithProviders(<IncidentMap providerId="github" providerName="GitHub" delay="0ms" className="md:col-span-3" />, {
    map: mapResponse,
    preferences: { theme: "dark", uiLocale: "en", notificationLocale: "en", mapView } satisfies Preferences,
  });

afterEach(() => vi.unstubAllGlobals());

describe("IncidentMap", () => {
  it("renders nothing when the operator has the map switched off", async () => {
    const { container } = mount("off");
    // Nothing to await: the whole point is that no tile and no request appear.
    expect(container).toBeEmptyDOMElement();
  });

  it("draws only the incident provider's own locations, never the whole fleet", async () => {
    mount("map");
    const world = await screen.findByRole("img", { name: i18n.t("map.aria.world") });
    const markers = within(world).getAllByRole("button");
    expect(markers).toHaveLength(1);
    expect(markers[0]).toHaveAccessibleName(/Ashburn/);
  });

  it("keeps a keyed empty state when this provider has no located component", async () => {
    mount("map", map({ points: [point("cloudflare", "Amsterdam", 52.31, 4.76)] }));
    expect(await screen.findByText(i18n.t("incident.map.empty", { name: "GitHub" }))).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: i18n.t("map.aria.world") })).not.toBeInTheDocument();
  });

  it("counts located and unplaced components for this provider only", async () => {
    mount(
      "map",
      map({
        unlocated: [
          { providerId: "github", providerName: "GitHub", count: 12 },
          { providerId: "cloudflare", providerName: "Cloudflare", count: 3 },
        ],
      }),
    );
    expect(
      await screen.findByText(i18n.t("map.footnote", { count: 1, unplaced: 12 })),
    ).toBeInTheDocument();
  });
});
