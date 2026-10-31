import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { statusLabelKey } from "@/lib/chartConfig.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import type { OverallStatus } from "@/lib/types.ts";
import { StatusAnnouncer } from "./StatusAnnouncer.tsx";

afterEach(() => vi.unstubAllGlobals());

function Page() {
  const client = useQueryClient();
  return (
    <>
      <StatusAnnouncer />
      <button type="button" onClick={() => void client.invalidateQueries({ queryKey: ["status"] })}>
        re-read
      </button>
    </>
  );
}

const fleet = (statuses: Record<string, OverallStatus>) => ({
  providers: Object.entries(statuses).map(([id, overallStatus]) => ({
    ...providerFixture(),
    id,
    name: id,
    overallStatus,
    enabled: true,
  })),
  pollIntervalMinutes: 3,
  lastPollAt: null,
  nextPollAt: null,
});

const region = () => document.querySelector('[data-slot="status-announcer"]') as HTMLElement;

describe("StatusAnnouncer", () => {
  it("is one polite, atomic live region that sighted users never see", () => {
    renderWithProviders(<Page />, { status: fleet({ github: "operational" }) });
    expect(region()).toHaveAttribute("role", "status");
    expect(region()).toHaveAttribute("aria-live", "polite");
    expect(region()).toHaveAttribute("aria-atomic", "true");
    expect(region()).toHaveClass("sr-only");
  });

  it("says nothing about the first read: there is no before to compare with", async () => {
    renderWithProviders(<Page />, { status: fleet({ github: "major_outage" }) });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(region()).toHaveTextContent("");
  });

  it("names a provider whose status changed between two reads", async () => {
    let reads = 0;
    renderWithProviders(<Page />, {
      status: () => {
        reads += 1;
        return fleet({ github: reads === 1 ? "operational" : "major_outage", vercel: "operational" });
      },
    });
    await waitFor(() => expect(reads).toBe(1));
    await userEvent.click(await screen.findByRole("button", { name: "re-read" }));

    await waitFor(() =>
      expect(region()).toHaveTextContent(
        i18n.t("announce.status-changed", { provider: "github", status: i18n.t(statusLabelKey("major_outage")) }),
      ),
    );
    expect(region()).not.toHaveTextContent("vercel");
  });

  it("names three and counts the rest", async () => {
    let reads = 0;
    renderWithProviders(<Page />, {
      status: () => {
        reads += 1;
        const status: OverallStatus = reads === 1 ? "operational" : "degraded";
        return fleet({ a: status, b: status, c: status, d: status, e: status });
      },
    });
    await waitFor(() => expect(reads).toBe(1));
    await userEvent.click(await screen.findByRole("button", { name: "re-read" }));

    await waitFor(() => expect(region()).toHaveTextContent(i18n.t("announce.status-more", { count: 2 })));
    expect(region()).toHaveTextContent("a");
    expect(region()).not.toHaveTextContent(/\be is now\b/);
  });
});
