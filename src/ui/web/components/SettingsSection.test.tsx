import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsSection } from "./SettingsSection.tsx";

describe("SettingsSection", () => {
  it("renders the kicker, the action beside it and the rows inside", () => {
    render(
      <SettingsSection title="Engine" action={<button type="button">Add</button>} delay="0ms">
        <div>row</div>
      </SettingsSection>,
    );
    expect(screen.getByText("Engine")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(screen.getByText("row")).toBeInTheDocument();
  });

  it("shows the note in the footer when there is nothing to report", () => {
    render(
      <SettingsSection title="Engine" note="Applied on the next cycle." delay="0ms">
        <div>row</div>
      </SettingsSection>,
    );
    expect(screen.getByText("Applied on the next cycle.")).toBeInTheDocument();
  });

  it("replaces the note with the status while one is showing", () => {
    render(
      <SettingsSection title="Engine" note="Applied on the next cycle." status="Saved" delay="0ms">
        <div>row</div>
      </SettingsSection>,
    );
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.queryByText("Applied on the next cycle.")).not.toBeInTheDocument();
  });

  it("renders no footer at all when neither a note nor a status is given", () => {
    const { container } = render(
      <SettingsSection title="Appearance" delay="0ms">
        <div>row</div>
      </SettingsSection>,
    );
    expect(container.querySelectorAll("[data-slot='settings-section-footer']")).toHaveLength(0);
  });

  it("carries the cascade delay it was given", () => {
    const { container } = render(
      <SettingsSection title="Engine" delay="120ms">
        <div>row</div>
      </SettingsSection>,
    );
    expect(container.querySelector("[data-slot='settings-section']")).toHaveStyle({ animationDelay: "120ms" });
  });
});
