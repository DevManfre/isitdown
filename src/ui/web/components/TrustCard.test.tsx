import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n.ts";
import { TrustCard } from "./TrustCard.tsx";
import type { TrustCardData } from "@/lib/types.ts";

const trust = vi.fn();

vi.mock("@/hooks/queries.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/queries.ts")>()),
  useTrust: (days: number) => trust(days),
}));

const card = (over: Partial<TrustCardData> = {}): TrustCardData => ({
  key: "acme-probe->acme",
  pair: { probeId: "acme-probe", pageId: "acme", componentId: "" },
  days: 90,
  counted: 11,
  excluded: { maintenance: 2, fleetBlind: 1 },
  delay: { medianMinutes: 34, p90Minutes: 91, admitted: 9 },
  coverage: { observedMinutes: 252, admittedMinutes: 154, percent: 61 },
  never: 2,
  afterRecovery: 1,
  resolutionMinutes: 5,
  ...over,
});

const show = (cards: TrustCardData[], providerId = "acme") => {
  trust.mockReturnValue({ data: { days: 90, windows: [30, 90, 365], cards } });
  return render(
    <I18nextProvider i18n={i18n}>
      <TrustCard providerId={providerId} />
    </I18nextProvider>,
  );
};

describe("the status-page accuracy card", () => {
  it("renders nothing for a provider no probe cross-checks", () => {
    const { container } = show([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a provider other than the one the pair is about", () => {
    const { container } = show([card()], "github");
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the three axes apart, with no combined score", () => {
    show([card()]);
    expect(screen.getByText("34 min median")).toBeInTheDocument();
    expect(screen.getByText("61%")).toBeInTheDocument();
    expect(screen.getByText("2 of 11")).toBeInTheDocument();
    // No grade, no letter, nothing that fuses the three into one verdict.
    expect(screen.queryByText(/score/i)).not.toBeInTheDocument();
  });

  it("carries what it excluded, its error bar and where it looked from", () => {
    show([card()]);
    expect(
      screen.getByText("Excluded 3 — 2 declared maintenance, 1 fleet-wide read failure"),
    ).toBeInTheDocument();
    expect(screen.getByText("±5 min, the coarser poll cadence")).toBeInTheDocument();
    expect(screen.getByText("Seen from one probe, one network, one location.")).toBeInTheDocument();
  });

  it("stays silent below the floor and says how far short it is", () => {
    // Built by hand rather than from the helper: below the floor the server
    // omits the three axes entirely, and a test that zeroed them would be
    // testing a response shape that never arrives.
    show([
      {
        key: "acme-probe->acme",
        pair: { probeId: "acme-probe", pageId: "acme", componentId: "" },
        days: 90,
        counted: 3,
        floor: 10,
      },
    ]);
    expect(screen.getByText("Not enough episodes to say anything")).toBeInTheDocument();
    expect(screen.getByText("3 disagreements in 90 days. 10 needed.")).toBeInTheDocument();
    // The axes are absent rather than zeroed: a median of nothing formatted as
    // a number reads exactly like a measurement.
    expect(screen.queryByText("Admission delay")).not.toBeInTheDocument();
  });

  it("names the component when the pair is narrowed to one", () => {
    show([
      card({
        key: "acme-probe->acme#api",
        pair: { probeId: "acme-probe", pageId: "acme", componentId: "api" },
      }),
    ]);
    expect(screen.getByText("acme-probe vs acme#api")).toBeInTheDocument();
  });

  it("offers every window the server allows", () => {
    show([card()]);
    for (const window of ["30d", "90d", "365d"]) {
      expect(screen.getByRole("button", { name: window })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "90d" })).toHaveAttribute("aria-pressed", "true");
  });
});
