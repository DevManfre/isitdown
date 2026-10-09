import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/harness.tsx";
import { StaleBadge } from "./StaleBadge.tsx";

describe("StaleBadge", () => {
  it("renders nothing for a reading that still looks alive", () => {
    renderWithProviders(<StaleBadge stale={null} />);
    expect(screen.queryByTestId("provider-stale")).not.toBeInTheDocument();
  });

  it("explains a shrunk reading with the counts filled in, from the keyboard", async () => {
    renderWithProviders(
      <StaleBadge stale={{ reason: "shrunk", since: "2026-08-19T14:00:00.000Z", components: 2, expected: 12 }} />,
    );
    const badge = screen.getByTestId("provider-stale");
    expect(badge).toHaveTextContent("Suspect reading");
    await userEvent.tab();
    expect(badge).toHaveFocus();
    expect((await screen.findAllByText(/Reads 2 of the 12 components/)).length).toBeGreaterThan(0);
  });

  it("explains an unchanged reading without a raw placeholder", async () => {
    renderWithProviders(
      <StaleBadge stale={{ reason: "unchanged", since: "2026-08-01T00:00:00.000Z", longestStillMs: 86_400_000 }} />,
    );
    await userEvent.tab();
    const [text] = await screen.findAllByText(/Unchanged since/);
    expect(text?.textContent).not.toMatch(/[{}]/);
  });
});
