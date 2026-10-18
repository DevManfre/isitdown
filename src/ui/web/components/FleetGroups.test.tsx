import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { FleetGroups } from "./FleetGroups.tsx";

describe("FleetGroups", () => {
  it("names each dot of the shut operational group, so it is not colour and hover alone", async () => {
    const providers = [
      providerFixture({ id: "github", name: "GitHub", overallStatus: "operational" }),
      providerFixture({ id: "stripe", name: "Stripe", overallStatus: "operational" }),
    ];
    renderWithProviders(<FleetGroups providers={providers} buckets={new Map()} />);

    const dot = await screen.findByRole("link", {
      name: i18n.t("fleet.dot-label", { name: "GitHub", status: i18n.t("status.operational") }),
    });
    expect(dot).toHaveAttribute("href", expect.stringContaining("github"));
  });
});
