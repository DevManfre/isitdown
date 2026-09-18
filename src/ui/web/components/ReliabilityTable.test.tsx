import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n.ts";
import { ReliabilityTable } from "./ReliabilityTable.tsx";
import type { ProviderReliability } from "@/lib/types.ts";

const provider = (
  over: Partial<ProviderReliability> = {},
): ProviderReliability => ({
  providerId: "github",
  incidents: 3,
  mttrMinutes: 90,
  resolved: 3,
  mtbfMinutes: 1440,
  longestOutageMinutes: 200,
  downtimeMinutes: 270,
  previousIncidents: 1,
  ...over,
});

const show = (providers: ProviderReliability[]) =>
  render(
    <I18nextProvider i18n={i18n}>
      <ReliabilityTable
        providers={providers}
        nameOf={(id) => id.toUpperCase()}
      />
    </I18nextProvider>,
  );

describe("ReliabilityTable", () => {
  it("says nothing to rank when the window holds no incidents", () => {
    show([provider({ incidents: 0 })]);
    expect(screen.getByText(i18n.t("reliability.empty"))).toBeInTheDocument();
    expect(screen.queryByText("GITHUB")).toBeNull();
  });

  it("prints a dash rather than a flawless zero for a figure the window cannot answer", () => {
    // One incident, still open: no MTTR to average and nothing to be between.
    show([
      provider({
        incidents: 1,
        resolved: 0,
        mttrMinutes: null,
        mtbfMinutes: null,
        longestOutageMinutes: null,
      }),
    ]);
    expect(screen.getAllByText("—")).toHaveLength(3);
  });

  it("shows which way the count is going, not just the count", () => {
    show([provider({ incidents: 3, previousIncidents: 1 })]);
    expect(screen.getByText(/\+2/)).toBeInTheDocument();
    show([provider({ incidents: 1, previousIncidents: 4 })]);
    expect(screen.getByText(/-3/)).toBeInTheDocument();
  });
});
