import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingRow } from "./SettingRow.tsx";

describe("SettingRow", () => {
  it("exposes the data-slot hook motion.css and tests select on", () => {
    render(
      <SettingRow label="Poll interval">
        <input aria-label="interval" />
      </SettingRow>,
    );
    expect(screen.getByLabelText("interval").closest("[data-slot='setting-row']")).not.toBeNull();
  });

  it("renders label, description, meta and the control together", () => {
    render(
      <SettingRow label="Poll interval" description="Requests are staggered." meta="5 min">
        <input aria-label="interval" />
      </SettingRow>,
    );
    expect(screen.getByText("Poll interval")).toBeInTheDocument();
    expect(screen.getByText("Requests are staggered.")).toBeInTheDocument();
    expect(screen.getByText("5 min")).toBeInTheDocument();
    expect(screen.getByLabelText("interval")).toBeInTheDocument();
  });

  it("renders no description element when none is given", () => {
    const { container } = render(
      <SettingRow label="Max retries">
        <input aria-label="retries" />
      </SettingRow>,
    );
    expect(container.querySelectorAll("[data-slot='setting-row-description']")).toHaveLength(0);
  });

  it("renders a leading marker before the label when given", () => {
    render(
      <SettingRow label="GitHub" leading={<span data-testid="dot" />}>
        <input aria-label="enabled" />
      </SettingRow>,
    );
    expect(screen.getByTestId("dot")).toBeInTheDocument();
  });

  it("marks the alignment it was asked for so a wrapping description can top-align", () => {
    const { container } = render(
      <SettingRow label="Geographic view" align="top">
        <input aria-label="map" />
      </SettingRow>,
    );
    expect(container.querySelector("[data-slot='setting-row']")).toHaveAttribute("data-align", "top");
  });

  it("defaults the alignment attribute rather than leaving it absent", () => {
    const { container } = render(
      <SettingRow label="Max retries">
        <input aria-label="retries" />
      </SettingRow>,
    );
    expect(container.querySelector("[data-slot='setting-row']")).toHaveAttribute("data-align", "center");
  });
});
