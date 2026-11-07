import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReplayPanel } from "@/components/ReplayPanel.tsx";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";

afterEach(() => vi.unstubAllGlobals());

const base = {
  notification: { id: 7, providerId: "github", channel: "telegram", kind: "status_change", sentAt: "2026-11-01T10:06:05.000Z", ok: true },
  replayedWith: "current-settings",
  replayable: true,
  available: true,
  reproduced: true,
  previous: { fetchedAt: "2026-11-01T10:03:00.000Z", overallStatus: "operational" },
  trigger: { fetchedAt: "2026-11-01T10:06:00.000Z", overallStatus: "major_outage" },
  path: [
    { step: "diff", outcome: "change", detail: { kind: "status_change", from: "operational", to: "major_outage", severity: "major_outage" } },
    { step: "damping", outcome: "confirmed", detail: { required: 3, held: ["2026-11-01T10:00:00.000Z", "2026-11-01T10:03:00.000Z"] } },
    {
      step: "routing",
      outcome: "rule",
      detail: {
        winner: 1,
        outcomes: [{ kind: "skipped", because: "provider" }, { kind: "won" }],
        rule: { provider: "*", minSeverity: "any", channels: ["*"] },
        severity: "major_outage",
      },
    },
    { step: "channel", outcome: "included", detail: { channel: "telegram", routed: ["telegram", "slack"] } },
    { step: "quiet-hours", outcome: "suppressed", detail: { start: "23:00", end: "07:00", timeZone: "UTC", minSeverity: "major_outage" } },
    { step: "cap", outcome: "at-limit", detail: { maxPerHour: 3, alertsInPreviousHour: 4 } },
  ],
};

async function ask(replay: unknown, id: number | undefined = 7): Promise<HTMLElement> {
  renderWithProviders(<ReplayPanel notificationId={id} />, { replay });
  await userEvent.click(screen.getByRole("button", { name: i18n.t("replay.action") }));
  return await screen.findByRole("region", { name: i18n.t("replay.title") });
}

const steps = (panel: HTMLElement) =>
  within(within(panel).getByRole("list")).getAllByRole("listitem").map((item) => item.textContent ?? "");

describe("ReplayPanel (roadmap 5.12)", () => {
  it("asks nothing until it is asked: the row alone costs no request", () => {
    renderWithProviders(<ReplayPanel notificationId={7} />, { replay: base });
    expect(screen.getByRole("button", { name: i18n.t("replay.action") })).toBeTruthy();
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([path]) => String(path));
    expect(calls.some((path) => path.endsWith("/replay"))).toBe(false);
  });

  it("walks the decision in the order it was made, with every status as a word", async () => {
    const panel = await ask(base);
    const [diff, damping, routing, channel, quiet, cap] = steps(panel);

    expect(diff).toContain(i18n.t("status.operational"));
    expect(diff).toContain(i18n.t("status.major-outage"));
    expect(damping).toContain(i18n.t("replay.step.damping-confirmed", { required: 3 }));
    // Rule number two of the table (index 1), sending to every enabled channel.
    expect(routing).toContain(
      i18n.t("replay.step.routing-rule", { number: 2, target: i18n.t("replay.target.any"), channels: i18n.t("replay.channels.all") }),
    );
    expect(channel).toContain(i18n.t("replay.step.channel-included", { channel: "telegram" }));
    // The exact sentence, not just the window: all four quiet-hours outcomes name it.
    expect(quiet).toBe(
      i18n.t("replay.step.quiet-suppressed", { start: "23:00", end: "07:00", zone: "UTC", floor: i18n.t("status.major-outage") }),
    );
    expect(cap).toBe(i18n.t("replay.step.cap-at-limit", { count: 4, max: 3 }));
  });

  it("says it was replayed with today's settings, because that is what it did", async () => {
    const panel = await ask(base);
    expect(within(panel).getByText(i18n.t("replay.with-today"))).toBeTruthy();
  });

  it("says plainly when today's settings would not have sent it, rather than inventing a path", async () => {
    const panel = await ask({ ...base, reproduced: false, trigger: null, previous: null, path: [{ step: "diff", outcome: "no-change", detail: { readings: 5 } }] });
    expect(within(panel).getByText(i18n.t("replay.not-reproduced"))).toBeTruthy();
    expect(within(panel).queryByRole("list")).toBeNull();
  });

  it("says the readings are gone once they have been trimmed", async () => {
    const panel = await ask({ ...base, available: false, reproduced: false, trigger: null, previous: null, path: [] });
    expect(within(panel).getByText(i18n.t("replay.unavailable"))).toBeTruthy();
  });

  it("says a report or a failing channel has nothing to replay", async () => {
    const panel = await ask({ ...base, replayable: false, reproduced: false, trigger: null, previous: null, path: [] });
    expect(within(panel).getByText(i18n.t("replay.not-replayable"))).toBeTruthy();
  });

  it("offers no button for a row with no id, such as one from before the log carried them", () => {
    renderWithProviders(<ReplayPanel notificationId={undefined} />, { replay: base });
    expect(screen.queryByRole("button", { name: i18n.t("replay.action") })).toBeNull();
  });

  it("reports a failed replay inline, where the question was asked", async () => {
    renderWithProviders(<ReplayPanel notificationId={7} />, { replay: base, errors: { replay: 500 } });
    await userEvent.click(screen.getByRole("button", { name: i18n.t("replay.action") }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/./);
  });
});
