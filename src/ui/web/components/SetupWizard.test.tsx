import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import { SetupWizard } from "./SetupWizard.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
});

const preferences = (wizardDone: boolean) => ({
  theme: "system",
  uiLocale: "en",
  notificationLocale: "en",
  mapView: "off",
  density: "comfortable",
  timeZone: "auto",
  lastSeenAt: null,
  wizardDone,
  tourSeen: false,
});
const empty = { pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null, providers: [] };
const config = {
  services: [],
  channels: [{ id: "telegram", enabled: false, fields: [{ name: "token", envVar: "T", isSet: false }], locale: "", template: "" }],
};
const catalog = { providers: [{ id: "github", name: "GitHub", adapter: "statuspage", baseUrl: "https://x.test", configured: false }] };

describe("SetupWizard — roadmap 4.5", () => {
  it("stays out of the way once it has been done, or when a channel is already on", () => {
    renderWithProviders(<SetupWizard />, { status: empty, config, catalog, preferences: preferences(true) });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays out of the way when a channel is already enabled", async () => {
    const on = { ...config, channels: [{ ...config.channels[0], enabled: true }] };
    renderWithProviders(<SetupWizard />, { status: empty, config: on, catalog, preferences: preferences(false) });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Browser push is enabled out of the box and reaches nobody until a browser
  // subscribes, so it neither counts as set up nor is offered for the test.
  it("ignores browser push when deciding to open, and does not offer it", async () => {
    const user = userEvent.setup();
    const withPush = { ...config, channels: [...config.channels, { id: "webpush", enabled: true, fields: [], locale: "", template: "" }] };
    renderWithProviders(<SetupWizard />, { status: { ...empty, providers: [{ id: "g", name: "G", enabled: true }] }, config: withPush, catalog, preferences: preferences(false) });

    await user.click(await screen.findByRole("button", { name: i18n.t("action.continue") }));
    await screen.findByText(i18n.t("wizard.title.2"));
    expect(screen.queryByRole("button", { name: i18n.t("channel.name.webpush", { defaultValue: "webpush" }) })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: i18n.t("channel.name.telegram") })).toBeInTheDocument();
  });

  it("opens on an installation with no channel and cannot continue with nothing picked on an empty fleet", async () => {
    renderWithProviders(<SetupWizard />, { status: empty, config, catalog, preferences: preferences(false) });

    expect(await screen.findByText(i18n.t("wizard.title.1"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: i18n.t("action.continue") })).toBeDisabled();
  });

  it("adds the picked provider, then holds the last step until a real test delivers", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SetupWizard />, { status: empty, config, catalog, preferences: preferences(false) });

    await user.click(await screen.findByRole("button", { name: "GitHub" }));
    await user.click(screen.getByRole("button", { name: i18n.t("action.continue") }));
    await screen.findByText(i18n.t("wizard.title.2"));

    const calls = (): unknown[][] => (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    await waitFor(() =>
      expect(calls().some((call) => String(call[0]) === "/config/services" && (call[1] as RequestInit).method === "POST")).toBe(true),
    );

    await user.click(screen.getByRole("button", { name: i18n.t("channel.name.telegram") }));
    expect(screen.getByRole("button", { name: i18n.t("wizard.save-continue") })).toBeDisabled();
    await user.type(screen.getByLabelText("token"), "123:abc");
    await user.click(screen.getByRole("button", { name: i18n.t("wizard.save-continue") }));

    await screen.findByText(i18n.t("wizard.title.3"));
    expect(screen.getByRole("button", { name: i18n.t("wizard.arrived") })).toBeDisabled();
  });
});
