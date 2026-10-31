import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import fixtures from "@/lib/accent.fixtures.json";
import type { Preferences } from "@/lib/types.ts";
import { IdentityRows } from "./IdentityRows.tsx";

afterEach(() => vi.unstubAllGlobals());

const base: Preferences = {
  theme: "system",
  uiLocale: "en",
  notificationLocale: "en",
  mapView: "off",
  density: "comfortable",
  accentColor: "",
  instanceName: "",
  logoUrl: "",
};

/** The JSON bodies of every PATCH /api/preferences the page sent. */
const patches = (): unknown[] =>
  (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls
    .filter(([path, init]) => String(path).startsWith("/api/preferences") && init?.method === "PATCH")
    .map(([, init]) => JSON.parse(String(init?.body)));

const mount = (preferences: Preferences = base, fixtures: Parameters<typeof renderWithProviders>[1] = {}) =>
  renderWithProviders(<IdentityRows preferences={preferences} />, { preferences, ...fixtures });

describe("IdentityRows", () => {
  it("writes a new instance name when the field is left, not on every keystroke", async () => {
    const user = userEvent.setup();
    mount();
    const field = screen.getByRole("textbox", { name: i18n.t("settings.instance-name.label") });
    await user.type(field, "Office wallboard");
    expect(patches()).toEqual([]);
    await user.tab();
    await waitFor(() => expect(patches()).toEqual([{ instanceName: "Office wallboard" }]));
  });

  it("trims what it sends and sends nothing when nothing changed", async () => {
    const user = userEvent.setup();
    mount({ ...base, instanceName: "Ops" });
    const field = screen.getByRole("textbox", { name: i18n.t("settings.instance-name.label") });
    await user.click(field);
    await user.tab();
    expect(patches()).toEqual([]);
    await user.type(field, "  ");
    await user.tab();
    expect(patches()).toEqual([]);
  });

  it("stops the name at the length the server accepts", () => {
    mount();
    expect(screen.getByRole("textbox", { name: i18n.t("settings.instance-name.label") })).toHaveAttribute("maxlength", "40");
  });

  it("writes the colour it was given, and the reset puts the product's own back", async () => {
    const user = userEvent.setup();
    mount({ ...base, accentColor: fixtures.picked });
    fireEvent.change(screen.getByLabelText(i18n.t("settings.accent.label")), { target: { value: fixtures.repicked } });
    await waitFor(() => expect(patches()).toContainEqual({ accentColor: fixtures.repicked }));
    await user.click(screen.getByRole("button", { name: i18n.t("settings.accent.reset") }));
    await waitFor(() => expect(patches()).toContainEqual({ accentColor: "" }));
  });

  it("has nothing to reset while the product's own accent is in use", () => {
    mount();
    expect(screen.getByRole("button", { name: i18n.t("settings.accent.reset") })).toBeDisabled();
  });

  it("says so, as an alert, when the server refuses the logo address", async () => {
    const user = userEvent.setup();
    mount(base, { errors: { preferences: 400 } });
    const field = screen.getByRole("textbox", { name: i18n.t("settings.logo.label") });
    await user.type(field, "javascript:alert(1)");
    await user.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("settings.logo.refused"));
    expect(field).toHaveAttribute("aria-invalid", "true");
    // Typing again is a fresh attempt, so the complaint about the last one goes.
    await user.type(field, "x");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
