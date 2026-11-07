import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComponentRows } from "@/components/ComponentRows.tsx";
import { renderWithProviders } from "@/test/harness.tsx";
import type { RoutingRule } from "@/lib/types.ts";

afterEach(() => vi.unstubAllGlobals());

const catchAll: RoutingRule = {
  provider: "*",
  classes: ["status", "incident", "maintenance", "monitoring"],
  minSeverity: "any",
  channels: ["*"],
};

const componentHistory = {
  provider: "github",
  days: 90,
  components: [
    {
      componentId: "actions",
      name: "Actions",
      buckets: [{ day: "2026-08-20", status: "operational" }],
      uptime7: 100,
      uptime30: 100,
      uptime90: 100,
      sampleCount: 90,
    },
  ],
};

const rowsFor = (rules: RoutingRule[], silenceable = true) =>
  renderWithProviders(
    <ComponentRows providerId="github" days={90} current={[]} silenceable={silenceable} />,
    { componentHistory, config: { routing: { rules, invalidRules: 0 } } },
  );

/** Every body the page PUT to the routing endpoint, parsed. */
const savedRules = (): RoutingRule[][] =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    .filter(([path, init]) => path === "/config/routing" && init?.method === "PUT")
    .map(([, init]) => (JSON.parse(init.body as string) as { rules: RoutingRule[] }).rules);

describe("silencing a component from its row (roadmap 5.13)", () => {
  it("saves a rule that sends nowhere, ahead of the rules already there", async () => {
    rowsFor([catchAll]);
    await userEvent.click(await screen.findByRole("button", { name: "Silence Actions" }));

    await waitFor(() => expect(savedRules()).toHaveLength(1));
    expect(savedRules()[0]).toEqual([
      { provider: "github#actions", classes: catchAll.classes, minSeverity: "any", channels: [] },
      catchAll,
    ]);
  });

  it("says a silenced component is silenced in words, and lifts the silence on the next click", async () => {
    rowsFor([{ ...catchAll, provider: "github#actions", channels: [] }, catchAll]);

    expect(await screen.findByText("Silenced")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop silencing Actions" }));

    await waitFor(() => expect(savedRules()).toEqual([[catchAll]]));
  });

  it("offers no button where the view did not ask for one", async () => {
    rowsFor([catchAll], false);

    await screen.findByText("Actions");
    expect(screen.queryByRole("button", { name: /silenc/i })).not.toBeInTheDocument();
  });
});
