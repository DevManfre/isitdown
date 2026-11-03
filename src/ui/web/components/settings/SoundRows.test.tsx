import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n.ts";
import { readSound, resetSoundCache } from "@/lib/sound.ts";
import { SettingsChromeProvider } from "@/components/settings/SettingsChrome.tsx";
import { SoundRows } from "./SoundRows.tsx";

const show = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <SettingsChromeProvider>
        <SoundRows />
      </SettingsChromeProvider>
    </I18nextProvider>,
  );

beforeEach(() => {
  window.localStorage.clear();
  resetSoundCache();
});
afterEach(() => window.localStorage.clear());

describe("SoundRows", () => {
  it("starts switched off, with the other controls disabled until it is on", () => {
    show();
    expect(screen.getByRole("switch", { name: i18n.t("settings.sound.label") })).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: i18n.t("settings.sound.volume") })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: i18n.t("settings.sound.severity") })).toBeDisabled();
    expect(screen.getByRole("button", { name: i18n.t("settings.sound.test") })).toBeDisabled();
  });

  it("turning it on is remembered in this browser and enables the rest", async () => {
    show();
    await userEvent.click(screen.getByRole("switch", { name: i18n.t("settings.sound.label") }));
    expect(readSound().enabled).toBe(true);
    expect(JSON.parse(window.localStorage.getItem("isitdown.sound") ?? "{}").enabled).toBe(true);
    expect(screen.getByRole("combobox", { name: i18n.t("settings.sound.volume") })).toBeEnabled();
    expect(screen.getByRole("button", { name: i18n.t("settings.sound.test") })).toBeEnabled();
  });

  it("says so when the browser refuses to let the test sound", async () => {
    show();
    await userEvent.click(screen.getByRole("switch", { name: i18n.t("settings.sound.label") }));
    // jsdom has no AudioContext: exactly the "browser kept it silent" case.
    await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.sound.test") }));
    expect(await screen.findByText(i18n.t("settings.sound.blocked"))).toBeInTheDocument();
  });
});
