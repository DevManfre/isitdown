import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import i18n from "@/lib/i18n.ts";
import { RoutingRules } from "./RoutingRules.tsx";
import type { RoutingRule } from "@/lib/types.ts";
import { explain } from "../../../core/routing.ts";
import type { StatusChange } from "../../../core/types.ts";

const channels = [
  { id: "telegram", enabled: true, fields: [] },
  { id: "slack", enabled: true, fields: [] },
  // Disabled on purpose: several dry-run assertions below need a channel that
  // exists but will never actually receive anything, matching what
  // buildNotifiers filters out before the dispatcher ever sees it.
  { id: "webhook", enabled: false, fields: [] },
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

  // Pins the layout fix: on a narrow viewport the row (five columns, a
  // four-item toggle-group, a channel multi-select, three action buttons) is
  // wider than the tile can be, so the table must sit in its own horizontally
  // scrolling container rather than relying on the tile's width. jsdom can't
  // measure layout, so this only checks the container exists and actually
  // contains the table — not pixel widths.
  it("wraps the rule table in its own horizontally scrolling container", () => {
    mount(
      <RoutingRules
        routing={{
          rules: [{ provider: "*", classes: ["status"], minSeverity: "any", channels: ["slack"] }],
          invalidRules: 0,
        }}
        channels={channels}
        services={services}
      />,
    );

    const scrollContainer = screen.getByTestId("routing-table-scroll");
    expect(scrollContainer.className).toMatch(/overflow-x-auto/);
    expect(within(scrollContainer).getByRole("table")).toBeInTheDocument();
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

  it("warns that a rule with no event classes can never fire, even in first position", () => {
    // `[].every(...)` is vacuously true, so a naive shadow check would say
    // nothing here (nothing is above rule 1) even though it is permanently
    // dead. It must get its own warning, not silence.
    mount(
      <RoutingRules
        routing={{
          rules: [{ provider: "*", classes: [], minSeverity: "any", channels: ["slack"] }],
          invalidRules: 0,
        }}
        channels={channels}
        services={services}
      />,
    );

    expect(within(screen.getByRole("table")).getByText(/can never fire/i)).toBeInTheDocument();
  });

  it("does not blame a rule above for shadowing a rule with no event classes", () => {
    mount(
      <RoutingRules
        routing={{
          rules: [
            { provider: "*", classes: ["status"], minSeverity: "any", channels: ["slack"] },
            { provider: "*", classes: [], minSeverity: "any", channels: ["telegram"] },
          ],
          invalidRules: 0,
        }}
        channels={channels}
        services={services}
      />,
    );

    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(within(rows[1]!).queryByText(/never evaluated/i)).not.toBeInTheDocument();
    expect(within(rows[1]!).getByText(/can never fire/i)).toBeInTheDocument();
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

  it("disables the row's controls while a save is in flight, so a second click cannot compute from stale state", () => {
    // Fully controlled from server state with no optimistic update: between
    // a click and the refetch, `rules` is stale and a second click's patch
    // would be computed from data the first click already invalidated,
    // silently losing it. Disabling the controls for that window is the
    // cheap mitigation.
    mount(
      <RoutingRules
        routing={{
          rules: [{ provider: "github", classes: ["status"], minSeverity: "any", channels: ["telegram"] }],
          invalidRules: 0,
        }}
        channels={channels}
        services={services}
        onSave={vi.fn()}
        saving
      />,
    );

    expect(screen.getByRole("button", { name: /move up/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /move down/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add rule" })).toBeDisabled();
  });

  it("says the actual fallback behaviour when there are no rules, not a silence claim", () => {
    mount(
      <RoutingRules routing={{ rules: [], invalidRules: 0 }} channels={channels} services={services} />,
    );
    // The server substitutes a catch-all for an empty table (dbConfigSource's
    // load()), so the empty state must say every channel still fires — the
    // opposite of "nobody is notified".
    expect(screen.getByText(/every change goes to every enabled channel/i)).toBeInTheDocument();
    expect(screen.queryByText(/notify nobody/i)).not.toBeInTheDocument();
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

    it("offers an incident canned event, so a rule targeting only the incident class can be dry-run at all", async () => {
      // DRYRUN_EVENTS previously covered status/maintenance/monitoring
      // changes but not incident_opened — one of the four toggleable event
      // classes, and the one most commonly targeted by a rule, had no way to
      // be exercised in the panel at all.
      const user = userEvent.setup();
      const incidentOnly: RoutingRule[] = [
        { provider: "github", classes: ["incident"], minSeverity: "any", channels: ["slack"] },
      ];
      mount(
        <RoutingRules routing={{ rules: incidentOnly, invalidRules: 0 }} channels={channels} services={dryRunServices} />,
      );

      // Default canned event is major-outage (a status class), which this
      // rule does not match.
      expect(screen.getByText(/no rule matches — nobody is notified/i)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /incident opened/i }));
      expect(screen.getByText(/matches — evaluation stops here/i)).toBeInTheDocument();
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
    // sorting it lets the assertion compare an exact SET against what would
    // actually be DELIVERED, rather than a per-channel getByText subset check
    // that would still pass if the verdict listed an extra, wrong channel.
    const verdictChannelNames = () =>
      screen
        .getByTestId("routing-dryrun-verdict")
        .textContent!.split(" · ")
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
        .sort();

    // Enabled channels only ("webhook" is disabled in `channels` above) —
    // explain()'s raw targets intersected with what's actually enabled is
    // what the dispatcher would send to, and it is what the panel must match.
    // Pinning to explain()'s raw output (as `resolveTargets` alone would)
    // shares the same blind spot the bug had, so this deliberately narrows it.
    const expectedChannelNames = (change: StatusChange) => {
      const enabled = new Set(["telegram", "slack"]);
      return explain(change, rules, [...enabled])
        .targets.filter((id) => enabled.has(id))
        .map((id) => i18n.t(`channel.name.${id}`))
        .sort();
    };

    it("the verdict's channel list always equals what would actually be delivered for the same change and rules", async () => {
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

    it("shows nobody-will-receive-this when the winning rule names only a disabled channel", () => {
      // `resolveTargets` deliberately passes a named channel verbatim even
      // when it is disabled — the dispatcher is what drops it. A dry run
      // that hand-rolled the wildcard expansion over `won.channels` (the old
      // bug) rendered "Generic webhook" here, promising a delivery the
      // server would never make.
      const namesDisabledChannel: RoutingRule[] = [
        { provider: "github", classes: ["status"], minSeverity: "any", channels: ["webhook"] },
      ];
      mount(
        <RoutingRules
          routing={{ rules: namesDisabledChannel, invalidRules: 0 }}
          channels={channels}
          services={dryRunServices}
        />,
      );

      expect(screen.getByText(/no channel will receive this/i)).toBeInTheDocument();
      // "Generic webhook" legitimately appears as a channel-picker toggle
      // label elsewhere in the row; scope to the verdict itself.
      expect(screen.getByTestId("routing-dryrun-verdict").textContent).not.toMatch(/generic webhook/i);
    });

    it("shows nobody-will-receive-this for a wildcard rule when every channel is disabled", () => {
      // `channels: ["*"]` with zero enabled channels has length 1, so the old
      // `won.channels.length === 0` muted-check never fired and the panel
      // rendered an empty verdict instead of saying so.
      const allDisabled = [
        { id: "telegram", enabled: false, fields: [] },
        { id: "slack", enabled: false, fields: [] },
      ];
      const wildcardRule: RoutingRule[] = [
        { provider: "github", classes: ["status"], minSeverity: "any", channels: ["*"] },
      ];
      mount(
        <RoutingRules
          routing={{ rules: wildcardRule, invalidRules: 0 }}
          channels={allDisabled}
          services={dryRunServices}
        />,
      );

      expect(screen.getByText(/no channel will receive this/i)).toBeInTheDocument();
    });
  });
});
