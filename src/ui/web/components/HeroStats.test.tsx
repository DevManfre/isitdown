import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { HeroStats } from "./HeroStats.tsx";

const providers = [
  providerFixture(),
  providerFixture({ id: "cf", name: "Cloudflare", overallStatus: "degraded" }),
  providerFixture({ id: "an", name: "Anthropic", overallStatus: "major_outage", failureCount: 2 }),
];

/**
 * The column's own text, whitespace collapsed. Every figure in here is one
 * `Trans` with two tickers inside it, so the assertions are about the sentence
 * the column renders rather than about which span holds which number.
 */
const columnText = async (): Promise<string> => {
  const column = await screen.findByTestId("hero-stats");
  return (column.textContent ?? "").replace(/\s+/g, " ");
};

describe("HeroStats", () => {
  it("splits the fleet by whether it is operational, not by whether it answered", async () => {
    renderWithProviders(<HeroStats providers={providers} average={97.78} />, {});

    // One operational of three, so two are in alarm — a degraded provider is in
    // alarm here even though its own poll succeeded.
    expect(await columnText()).toContain(
      i18n.t("overview.stat.mix", { up: 1, alarm: 2, interpolation: { escapeValue: false } })
        .replace(/<\/?\d>/g, ""),
    );
  });

  it("counts a provider whose last poll failed as one that did not answer", async () => {
    renderWithProviders(<HeroStats providers={providers} average={97.78} />, {});

    expect(await columnText()).toContain(
      i18n
        .t("overview.stat.answered", { answered: 2, total: 3, interpolation: { escapeValue: false } })
        .replace(/<\/?\d>/g, ""),
    );
  });

  it("states the fleet's own average, in the window the label names", async () => {
    renderWithProviders(<HeroStats providers={providers} average={97.78} />, {});

    expect(await screen.findByText(i18n.t("overview.summary.window"))).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: i18n.t("overview.stat.arc", { uptime: "97.78" }) }),
    ).toBeInTheDocument();
  });
});
