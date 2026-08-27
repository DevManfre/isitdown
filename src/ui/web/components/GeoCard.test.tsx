import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createHashRouter, RouterProvider } from "react-router";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n.ts";
import { GeoCard } from "./GeoCard.tsx";
import type { MapResponse, Preferences } from "@/lib/types.ts";

const getMap = vi.fn();
const preferences = vi.fn();

vi.mock("@/hooks/queries.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/queries.ts")>()),
  useMap: (enabled: boolean) => {
    if (!enabled) return { data: undefined, isError: false };
    return getMap();
  },
  usePreferences: () => preferences(),
}));

// happy-dom has no WebGL, so cobe's canvas cannot be exercised here at all —
// same reason Task 13's StatusGlobe.test.tsx mocks it. Without this, the
// "draws the globe" case below would throw inside cobe rather than test this
// card's own branching.
//
// No top-level variable is referenced inside the factory (unlike
// StatusGlobe.test.tsx, which gets away with it only because it imports its
// subject dynamically, after the mock variable is declared): this file
// statically imports GeoCard.tsx up top, which transitively imports "cobe"
// before any later `const` in this file would have initialised, so reading
// one here would throw "Cannot access before initialization".
vi.mock("cobe", () => ({ default: () => ({ destroy: () => {} }) }));

const point = (lat: number, lon: number, status: MapResponse["points"][number]["status"] = "operational") => ({
  providerId: "cloudflare",
  providerName: "Cloudflare",
  componentId: `${lat},${lon}`,
  name: `Somewhere ${lat},${lon}`,
  lat,
  lon,
  status,
  source: "iata" as const,
});

const prefs = (mapView: Preferences["mapView"]) => ({ data: { mapView } });

/**
 * `GeoCard` calls `useNavigate()` (for `onSelect`) and `useTranslation()`
 * directly, so rendering it needs a router and an initialised i18n instance
 * around it — neither of which the brief's own render call supplies, and
 * both are required for the component to mount at all, not merely to read
 * translated text. `TooltipProvider` is deliberately not added here: the
 * card supplies that itself around the map/globe it draws (see GeoCard.tsx),
 * so wrapping it again here would just be redundant, unlike DottedWorld's
 * and StatusGlobe's own isolated tests, which get neither from their subject
 * and must supply both.
 */
function renderCard() {
  const router = createHashRouter([{ path: "*", element: <GeoCard /> }]);
  return render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

describe("GeoCard", () => {
  it("renders nothing and issues no request when the preference is off", () => {
    preferences.mockReturnValue(prefs("off"));
    getMap.mockImplementation(() => {
      throw new Error("useMap must not be enabled when mapView is off");
    });
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it("explains itself when nothing could be placed", () => {
    preferences.mockReturnValue(prefs("map"));
    getMap.mockReturnValue({
      data: {
        points: [],
        unlocated: [{ providerId: "github", providerName: "GitHub", count: 12 }],
        generatedAt: null,
      } satisfies MapResponse,
      isError: false,
    });
    renderCard();
    // A blank world map with no sentence is the state this exists to avoid.
    expect(screen.getByText(/12/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    // The brief's own suspicion about the error test ("would it pass if the
    // card rendered an error for every state?") applies just as much here:
    // an alert that leaked into every branch would only ever be caught by a
    // test that checks its *absence* somewhere the error state isn't in
    // play. Verified by negative control — see task-14-report.md.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("draws the map and always states what it could not place", () => {
    preferences.mockReturnValue(prefs("map"));
    getMap.mockReturnValue({
      data: {
        points: [point(52.31, 4.76), point(50.11, 8.68, "major_outage")],
        unlocated: [{ providerId: "github", providerName: "GitHub", count: 12 }],
        generatedAt: "2026-08-27T10:00:00.000Z",
      } satisfies MapResponse,
      isError: false,
    });
    renderCard();
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.getByText(/12/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an error state when the request failed", () => {
    preferences.mockReturnValue(prefs("map"));
    getMap.mockReturnValue({ data: undefined, isError: true });
    renderCard();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("draws the globe when the preference says globe", () => {
    preferences.mockReturnValue(prefs("globe"));
    getMap.mockReturnValue({
      data: { points: [point(52.31, 4.76)], unlocated: [], generatedAt: "2026-08-27T10:00:00.000Z" },
      isError: false,
    });
    renderCard();
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/globe|globo/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
