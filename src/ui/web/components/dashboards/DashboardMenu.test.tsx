import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { FLEET_ORDER_EVENT } from "@/components/FleetOrderDialog.tsx";
import { CUSTOMISE_EVENT, DashboardMenu } from "./DashboardMenu.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

const status = (count: number) => ({
  providers: Array.from({ length: count }, (_, i) => providerFixture({ id: `p${i}`, name: `P${i}` })),
  pollIntervalMinutes: 5,
  lastPollAt: null,
  nextPollAt: null,
});

const openMenu = async () => {
  const trigger = await screen.findByRole("button", { name: i18n.t("dashboards.menu", { name: "Overview" }) });
  await userEvent.click(trigger);
};

// The calm hero (dashboard-design-direction) no longer carries Customise and
// Arrange, so the title's "···" menu is their visible way in.
describe("DashboardMenu", () => {
  it("asks the Overview to open its editor from Customise", async () => {
    const heard = vi.fn();
    window.addEventListener(CUSTOMISE_EVENT, heard);
    renderWithProviders(<DashboardMenu />, { status: status(2) }, "/overview");
    await openMenu();
    const item = await screen.findByRole("menuitem", { name: i18n.t("dashboard.customise") });
    await waitFor(() => expect(item).not.toHaveAttribute("aria-disabled"));
    await userEvent.click(item);
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(CUSTOMISE_EVENT, heard);
  });

  it("does not offer Customise while the layout cannot be read", async () => {
    renderWithProviders(<DashboardMenu />, { status: status(2), errors: { dashboard: 500 } }, "/overview");
    await openMenu();
    await waitFor(async () =>
      expect(await screen.findByRole("menuitem", { name: i18n.t("dashboard.customise") })).toHaveAttribute("aria-disabled", "true"),
    );
  });

  it("asks the fleet order dialog to open from Arrange", async () => {
    const heard = vi.fn();
    window.addEventListener(FLEET_ORDER_EVENT, heard);
    renderWithProviders(<DashboardMenu />, { status: status(2) }, "/overview");
    await openMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: i18n.t("fleet-order.open") }));
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(FLEET_ORDER_EVENT, heard);
  });

  it("disables Arrange while there is nothing to order", async () => {
    renderWithProviders(<DashboardMenu />, { status: status(1) }, "/overview");
    await openMenu();
    expect(await screen.findByRole("menuitem", { name: i18n.t("fleet-order.open") })).toHaveAttribute("aria-disabled", "true");
  });
});
