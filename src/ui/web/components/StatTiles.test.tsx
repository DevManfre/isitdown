import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/harness.tsx";
import { StatTiles } from "./StatTiles.tsx";

describe("StatTiles", () => {
  it("renders one tile per stat, keyed by the id a caller can find it with", async () => {
    renderWithProviders(
      <StatTiles
        stats={[
          { id: "sent", label: "Sent", value: "124", note: "96.9% of attempts" },
          { id: "failed", label: "Failed", value: "4", accent: "var(--status-major-outage)" },
        ]}
      />,
      {},
    );

    const sent = await screen.findByText("Sent");
    expect(sent.closest("[data-stat='sent']")).not.toBeNull();
    expect(screen.getByText("124")).toBeInTheDocument();
    expect(screen.getByText("96.9% of attempts")).toBeInTheDocument();
    expect(screen.getByText("Failed").closest("[data-stat='failed']")).not.toBeNull();
  });

  it("leaves the note out rather than reserving an empty line for it", async () => {
    renderWithProviders(<StatTiles stats={[{ id: "only", label: "Only", value: "1" }]} />, {});

    const tile = (await screen.findByText("Only")).closest("[data-stat='only']");
    expect((tile?.textContent ?? "").trim()).toBe("Only1");
  });
});
