import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
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

  // The countdown reaching zero used to be a dead end: nothing re-asked the
  // server for the new deadline until the flat 30s status refetch came round,
  // so "0s" sat on screen for up to half a minute after every cycle.
  it("re-asks the server once the countdown is spent, instead of sitting at zero", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const status = {
        providers: [],
        pollIntervalMinutes: 3,
        lastPollAt: new Date(Date.now() - 190_000).toISOString(),
        nextPollAt: new Date(Date.now() - 10_000).toISOString(),
      };
      renderWithProviders(<PollIndicator />, { status });
      expect(await screen.findByText(i18n.t("meta.polling"))).toBeInTheDocument();

      const fetched = () =>
        (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
      const before = fetched();

      status.nextPollAt = new Date(Date.now() + 600_000).toISOString();
      await vi.advanceTimersByTimeAsync(4_000);

      expect(fetched()).toBeGreaterThan(before);
      // The exact remainder depends on how much time the render itself took;
      // what matters is that the countdown left the polling state and is
      // running again.
      expect(await screen.findByText(/^\d+m \d+s$/)).toBeInTheDocument();
      expect(screen.queryByText(i18n.t("meta.polling"))).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // The container stamps nextPollAt on its own clock. A browser running ahead
  // of it — a WSL2 or VM host that drifted across a suspend — read every
  // deadline as long expired and pinned the countdown at "0s" until the clocks
  // resynced. Nothing caught it: every other test here shares one clock.
  it("counts down on the server's clock when the browser's has drifted ahead", async () => {
    const serverNow = new Date(Date.now() - 600_000).toISOString();
    renderWithProviders(<PollIndicator />, {
      status: {
        providers: [],
        pollIntervalMinutes: 3,
        lastPollAt: new Date(Date.now() - 660_000).toISOString(),
        // Two minutes ahead of the server, eight minutes behind the browser.
        nextPollAt: new Date(Date.now() - 480_000).toISOString(),
        serverNow,
      },
    });

    expect(await screen.findByText(/^\dm \d+s$/)).toBeInTheDocument();
    expect(screen.queryByText("0s")).not.toBeInTheDocument();
  });

  // "0s" said nothing an operator could act on: the cycle is running upstream
  // and the countdown has simply run out. The CTA carries that state instead —
  // disabled, spinning — and the label says it in words.
  describe("while the cycle is running", () => {
    const cta = () => screen.getByRole("button");

    it("disables the CTA and shows it spinning once the deadline has passed", async () => {
      const serverNow = new Date().toISOString();
      renderWithProviders(<PollIndicator />, {
        status: {
          providers: [],
          pollIntervalMinutes: 3,
          lastPollAt: new Date(Date.now() - 190_000).toISOString(),
          nextPollAt: new Date(Date.now() - 4_000).toISOString(),
          serverNow,
        },
      });

      expect(await screen.findByText(i18n.t("meta.polling"))).toBeInTheDocument();
      expect(cta()).toBeDisabled();
      expect(cta()).toHaveAttribute("aria-busy", "true");
      expect(cta().querySelector("svg")).not.toBeNull();
      expect(screen.queryByText("0s")).not.toBeInTheDocument();
    });

    it("leaves the CTA usable while the countdown is still running", async () => {
      const serverNow = new Date().toISOString();
      renderWithProviders(<PollIndicator />, {
        status: {
          providers: [],
          pollIntervalMinutes: 3,
          lastPollAt: serverNow,
          nextPollAt: new Date(Date.now() + 95_000).toISOString(),
          serverNow,
        },
      });

      expect(await screen.findByText(/^1m \d+s$/)).toBeInTheDocument();
      expect(cta()).toBeEnabled();
      expect(cta()).not.toHaveAttribute("aria-busy", "true");
      expect(screen.queryByText(i18n.t("meta.polling"))).not.toBeInTheDocument();
    });
  });
});
