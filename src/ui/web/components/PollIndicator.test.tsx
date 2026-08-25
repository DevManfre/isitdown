import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness.tsx";
import { PollIndicator } from "./PollIndicator.tsx";

afterEach(() => vi.unstubAllGlobals());

describe("PollIndicator", () => {
  // No test elsewhere asserts this against anything but t() itself, which
  // passes even when a template's placeholders go unfilled — the bug class
  // Task 8 actually found here (a raw "{seconds}s" reaching the page).
  it("renders the literal countdown as minutes and seconds, not a raw placeholder", async () => {
    renderWithProviders(<PollIndicator />, {
      status: {
        providers: [],
        pollIntervalMinutes: 5,
        lastPollAt: null,
        nextPollAt: new Date(Date.now() + 64_000).toISOString(),
      },
    });
    expect(await screen.findByText("1m 4s")).toBeInTheDocument();
  });
});
