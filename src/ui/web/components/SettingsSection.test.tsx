import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsSection } from "./SettingsSection.tsx";

describe("SettingsSection", () => {
  it("renders the kicker, the action beside it and the rows inside", () => {
    render(
      <SettingsSection id="engine" title="Engine" action={<button type="button">Add</button>} delay="0ms">
        <div>row</div>
      </SettingsSection>,
    );
    expect(screen.getByText("Engine")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(screen.getByText("row")).toBeInTheDocument();
  });

  it("shows the note in the footer when there is nothing to report", () => {
    render(
      <SettingsSection id="engine" title="Engine" note="Applied on the next cycle." delay="0ms">
        <div>row</div>
      </SettingsSection>,
    );
    expect(screen.getByText("Applied on the next cycle.")).toBeInTheDocument();
  });

  it("replaces the note with the status while one is showing", () => {
    render(
      <SettingsSection id="engine" title="Engine" note="Applied on the next cycle." status="Saved" delay="0ms">
        <div>row</div>
      </SettingsSection>,
    );
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.queryByText("Applied on the next cycle.")).not.toBeInTheDocument();
  });

  it("renders no footer at all when neither a note nor a status is given", () => {
    const { container } = render(
      <SettingsSection id="engine" title="Appearance" delay="0ms">
        <div>row</div>
      </SettingsSection>,
    );
    expect(container.querySelectorAll("[data-slot='settings-section-footer']")).toHaveLength(0);
  });

  it("keeps the plain card, and no motion band, when no reel is given", () => {
    const { container } = render(
      <SettingsSection id="engine" title="Engine" delay="0ms">
        <div>row</div>
      </SettingsSection>,
    );
    expect(container.querySelectorAll("[data-slot='settings-reel']")).toHaveLength(0);
  });

  it("puts the reel behind the tile, hidden from assistive technology, with the rows still shown", () => {
    const { container } = render(
      <SettingsSection id="engine" title="Engine" reel={() => {}} note="Applied live." delay="0ms">
        <div>row</div>
      </SettingsSection>,
    );
    const reel = container.querySelector("[data-slot='settings-reel']");
    expect(reel).not.toBeNull();
    expect(reel).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("row")).toBeInTheDocument();
    expect(screen.getByText("Applied live.")).toBeInTheDocument();
  });

  it("carries the cascade delay it was given", () => {
    const { container } = render(
      <SettingsSection id="engine" title="Engine" delay="120ms">
        <div>row</div>
      </SettingsSection>,
    );
    expect(container.querySelector("[data-slot='settings-section']")).toHaveStyle({ animationDelay: "120ms" });
  });
});
