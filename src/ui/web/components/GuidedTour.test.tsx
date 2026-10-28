import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import { GuidedTour, startGuidedTour } from "./GuidedTour.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const preferences = { theme: "system", uiLocale: "en", notificationLocale: "en", mapView: "off", density: "comfortable", timeZone: "auto", lastSeenAt: null, wizardDone: false, tourSeen: false };

/** jsdom lays nothing out, so an anchor needs a size to count as drawn. */
const anchor = (name: string): void => {
  const element = document.createElement("div");
  element.dataset["tour"] = name;
  element.getBoundingClientRect = () => ({ width: 100, height: 40, top: 10, left: 10, right: 110, bottom: 50, x: 10, y: 10, toJSON: () => ({}) });
  document.body.append(element);
};

describe("GuidedTour — roadmap 4.6", () => {
  it("does not start by itself before the wizard has handed over", () => {
    anchor("rail");
    renderWithProviders(<GuidedTour />, { preferences });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("runs from the review button, one sentence per step, and can be skipped", async () => {
    const user = userEvent.setup();
    anchor("rail");
    anchor("nav-incidents");
    renderWithProviders(<GuidedTour />, { preferences });

    act(() => startGuidedTour());
    expect(await screen.findByText(i18n.t("tour.rail"))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: i18n.t("tour.skip") }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.some((call) => String(call[0]) === "/api/preferences" && String((call[1] as RequestInit).body).includes("tourSeen"))).toBe(true);
  });

  it("skips a step whose anchor is not on the page", async () => {
    anchor("rail");
    anchor("nav-incidents");
    const user = userEvent.setup();
    // On the Overview already, so the missing tile is skipped rather than
    // navigated to — leaving the route would unmount this test's only element.
    renderWithProviders(<GuidedTour />, { preferences }, "/overview");
    act(() => startGuidedTour());
    await screen.findByText(i18n.t("tour.rail"));

    await user.click(screen.getByRole("button", { name: i18n.t("action.continue") }));

    expect(await screen.findByText(i18n.t("tour.incidents"), {}, { timeout: 2000 })).toBeInTheDocument();
  });
});
