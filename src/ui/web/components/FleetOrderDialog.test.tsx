import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { FleetOrderDialog } from "./FleetOrderDialog.tsx";

/** Roadmap 4.24: arranging the fleet by hand. */

afterEach(() => vi.unstubAllGlobals());

const status = {
  providers: [
    providerFixture({ id: "anthropic", name: "Anthropic" }),
    providerFixture({ id: "cloudflare", name: "Cloudflare" }),
    providerFixture({ id: "github", name: "GitHub" }),
  ],
  groups: [],
  pollIntervalMinutes: 5,
  lastPollAt: null,
  nextPollAt: null,
};
const preferences = { theme: "system", uiLocale: "en", notificationLocale: "en", mapView: "off", density: "comfortable", fleetOrder: [], groupOrder: [] };

const rowNames = () =>
  screen
    .getAllByRole("listitem")
    .map((row) => row.textContent?.replace(/^\d+/, "") ?? "");

/** The body each PATCH carried, in order. */
const patches = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as unknown);

describe("FleetOrderDialog", () => {
  it("moves a provider from the keyboard and saves the new order", async () => {
    renderWithProviders(<FleetOrderDialog />, { status, preferences });
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("fleet-order.open") }));
    const dialog = await screen.findByRole("dialog");
    expect(rowNames()).toEqual(["Anthropic", "Cloudflare", "GitHub"]);
    // Save says nothing until something moved.
    expect(within(dialog).getByRole("button", { name: i18n.t("action.save") })).toBeDisabled();

    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("fleet-order.move-up", { name: "GitHub" }) }));
    expect(rowNames()).toEqual(["Anthropic", "GitHub", "Cloudflare"]);
    expect(screen.getByRole("status")).toHaveTextContent(
      i18n.t("fleet-order.moved", { name: "GitHub", position: 2, total: 3 }),
    );

    // Moved to the top, the row keeps focus on the arrow that moved it.
    const up = within(dialog).getByRole("button", { name: i18n.t("fleet-order.move-up", { name: "GitHub" }) });
    await userEvent.click(up);
    expect(rowNames()).toEqual(["GitHub", "Anthropic", "Cloudflare"]);
    expect(up).toHaveFocus();
    expect(up).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(up);
    expect(rowNames()).toEqual(["GitHub", "Anthropic", "Cloudflare"]);

    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.save") }));
    expect(patches()).toEqual([{ fleetOrder: ["github", "anthropic", "cloudflare"], groupOrder: [] }]);
  });

  it("asks before throwing a moved list away", async () => {
    renderWithProviders(<FleetOrderDialog />, { status, preferences });
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("fleet-order.open") }));
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("fleet-order.move-down", { name: "Anthropic" }) }));
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByText(i18n.t("fleet-order.discard.title"))).toBeInTheDocument();
    expect(patches()).toEqual([]);
  });

  it("offers the automatic order only once a manual one is saved", async () => {
    renderWithProviders(<FleetOrderDialog />, { status, preferences: { ...preferences, fleetOrder: ["github"] } });
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("fleet-order.open") }));
    const automatic = await screen.findByRole("button", { name: i18n.t("fleet-order.automatic") });
    expect(automatic).toBeEnabled();
    await userEvent.click(automatic);
    // Forgetting an arranged order asks first.
    expect(patches()).toEqual([]);
    const confirm = await screen.findByRole("dialog", { name: i18n.t("fleet-order.automatic-confirm.title") });
    await userEvent.click(within(confirm).getByRole("button", { name: i18n.t("fleet-order.automatic") }));
    expect(patches()).toEqual([{ fleetOrder: [], groupOrder: [] }]);
  });

  it("is not offered for a fleet with nothing to arrange", async () => {
    renderWithProviders(<FleetOrderDialog />, { status: { ...status, providers: [providerFixture()] }, preferences });
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).startsWith("/status"))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("button", { name: i18n.t("fleet-order.open") })).not.toBeInTheDocument();
  });
});
