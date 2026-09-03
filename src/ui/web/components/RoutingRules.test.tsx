import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import i18n from "@/lib/i18n.ts";
import { RoutingRules } from "./RoutingRules.tsx";
import type { RoutingRule } from "@/lib/types.ts";
import { resolveTargets } from "../../../core/routing.ts";
import type { StatusChange } from "../../../core/types.ts";

const channels = [
  { id: "telegram", enabled: true, fields: [] },
  { id: "slack", enabled: true, fields: [] },
];
const services = [{ id: "github", name: "GitHub" }];

const mount = (element: ReactElement) =>
  render(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);

describe("RoutingRules", () => {
  it("numbers the rules so the order is readable", () => {
    mount(
      <RoutingRules
        routing={{
          rules: [
            { provider: "github", classes: ["status"], minSeverity: "any", channels: [] },
            { provider: "*", classes: ["status"], minSeverity: "any", channels: ["slack"] },
          ],
          invalidRules: 0,
        }}
        channels={channels}
        services={services}
      />,
    );

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("1")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("2")).toBeInTheDocument();
  });

  it("marks a rule that can never be evaluated", () => {
    mount(
      <RoutingRules
        routing={{
          rules: [
            {
              provider: "*",
              classes: ["status", "incident", "maintenance", "monitoring"],
              minSeverity: "any",
              channels: ["*"],
            },
            { provider: "github", classes: ["status"], minSeverity: "any", channels: ["slack"] },
          ],
          invalidRules: 0,
        }}
        channels={channels}
        services={services}
      />,
    );

    // Scoped to the table: the dry run below it can independently report its
    // own trace rule as "never evaluated", which is a different question
    // (shadowing is "can this rule EVER fire", the dry run is "did it fire
    // for this one event") that happens to share wording by design.
    expect(within(screen.getByRole("table")).getByText(/never evaluated/i)).toBeInTheDocument();
  });

  it("saves the whole list when a rule moves up", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    mount(
      <RoutingRules
        routing={{
          rules: [
            { provider: "github", classes: ["status"], minSeverity: "any", channels: ["telegram"] },
            { provider: "*", classes: ["status"], minSeverity: "any", channels: ["slack"] },
          ],
          invalidRules: 0,
        }}
        channels={channels}
        services={services}
        onSave={save}
      />,
    );

    await userEvent.click(screen.getAllByRole("button", { name: /move up/i })[1]!);

    expect(save).toHaveBeenCalledWith([
      { provider: "*", classes: ["status"], minSeverity: "any", channels: ["slack"] },
      { provider: "github", classes: ["status"], minSeverity: "any", channels: ["telegram"] },
    ]);
  });

  it("says when a saved rule could not be read", () => {
    mount(
      <RoutingRules routing={{ rules: [], invalidRules: 2 }} channels={channels} services={services} />,
    );
    expect(screen.getByText(/could not be read/i)).toBeInTheDocument();
  });

  it("shows a rule with no channels as muted", () => {
    mount(
      <RoutingRules
        routing={{
          rules: [{ provider: "*", classes: ["status"], minSeverity: "any", channels: [] }],
          invalidRules: 0,
        }}
        channels={channels}
        services={services}
      />,
    );
    // Scoped to the table for the same reason as above: the dry run's own
    // verdict can independently say "Muted by rule …" for the same rule set.
    expect(within(screen.getByRole("table")).getByText(/muted/i)).toBeInTheDocument();
  });

  describe("dry run", () => {
    // The two rules the dry-run assertions below turn on: a GitHub-specific
    // rule ahead of a catch-all, so a GitHub event has exactly one winner and
    // a Sentry event falls through to the catch-all's own outcome.
    const rules: RoutingRule[] = [
      { provider: "github", classes: ["status"], minSeverity: "any", channels: ["slack"] },
      { provider: "*", classes: ["status", "incident", "maintenance", "monitoring"], minSeverity: "any", channels: ["*"] },
    ];
    const dryRunServices = [
      { id: "github", name: "GitHub" },
      { id: "sentry", name: "Sentry" },
    ];

    it("shows exactly one winner for the picked provider and event, and every rule after it as never evaluated", () => {
      mount(
        <RoutingRules routing={{ rules, invalidRules: 0 }} channels={channels} services={dryRunServices} />,
      );

      // Default dry run is the first provider (github) and the major-outage
      // canned event, which is rule 1's own worked example.
      expect(screen.getByText(/matches — evaluation stops here/i)).toBeInTheDocument();
      expect(screen.getByText(/never evaluated/i)).toBeInTheDocument();
    });

    it("renders the muted verdict naming the winning rule when it has no channels", () => {
      const muted: RoutingRule[] = [
        { provider: "github", classes: ["status"], minSeverity: "any", channels: [] },
      ];
      mount(
        <RoutingRules routing={{ rules: muted, invalidRules: 0 }} channels={channels} services={dryRunServices} />,
      );

      expect(screen.getByText(/muted by rule 1/i)).toBeInTheDocument();
    });

    it("shows the nobody-is-notified verdict when no rule matches", async () => {
      const user = userEvent.setup();
      const onlySentry: RoutingRule[] = [
        { provider: "sentry", classes: ["status"], minSeverity: "any", channels: ["slack"] },
      ];
      mount(
        <RoutingRules
          routing={{ rules: onlySentry, invalidRules: 0 }}
          channels={channels}
          services={dryRunServices}
        />,
      );

      // Default provider is github, which the only rule does not name.
      await user.click(screen.getByRole("button", { name: "GitHub" }));
      expect(screen.getByText(/no rule matches — nobody is notified/i)).toBeInTheDocument();
    });

    // The verdict renders its channel list as `t("channel.name.<id>")` values
    // joined with " · " (RoutingRules.tsx line ~102). Reading that back and
    // sorting it lets the assertion compare an exact SET against
    // resolveTargets's own output, rather than a per-channel getByText
    // subset check that would still pass if the verdict listed an extra,
    // wrong channel.
    const verdictChannelNames = () =>
      screen
        .getByTestId("routing-dryrun-verdict")
        .textContent!.split(" · ")
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
        .sort();

    const expectedChannelNames = (change: StatusChange) =>
      resolveTargets(change, rules, ["telegram", "slack"])
        .map((id) => i18n.t(`channel.name.${id}`))
        .sort();

    it("the verdict's channel list always equals what resolveTargets returns for the same change and rules", async () => {
      const user = userEvent.setup();
      mount(
        <RoutingRules routing={{ rules, invalidRules: 0 }} channels={channels} services={dryRunServices} />,
      );

      // State 1: the default dry run — github provider, major-outage event,
      // exactly the StatusChange shape the panel feeds to core's own
      // evaluator. Rule 1 (github-specific) wins here.
      const majorOutage: StatusChange = {
        kind: "status_change",
        providerId: "github",
        previousStatus: "operational",
        currentStatus: "major_outage",
        at: new Date().toISOString(),
      };
      expect(verdictChannelNames()).toEqual(expectedChannelNames(majorOutage));

      // State 2: reached by CLICKING the provider picker, not the default —
      // switching to Sentry takes rule 1 (github-only) out of contention, so
      // the catch-all rule ("*" channels, i.e. every enabled channel) wins
      // instead. A wrong implementation that hardcoded rule 1's channels, or
      // that widened the set past what explain() actually returns, would
      // fail this exact-set comparison where the old subset check would not.
      await user.click(screen.getByRole("button", { name: "Sentry" }));
      const sentryMajorOutage: StatusChange = { ...majorOutage, providerId: "sentry" };
      expect(verdictChannelNames()).toEqual(expectedChannelNames(sentryMajorOutage));
    });
  });
});
