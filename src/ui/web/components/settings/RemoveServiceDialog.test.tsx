import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import type { ServiceDefinition, ServiceImpact } from "@/lib/types.ts";
import { Button } from "@/components/ui/button.tsx";
import { RemoveServiceDialog } from "./RemoveServiceDialog.tsx";

const service: ServiceDefinition = {
  id: "github",
  name: "GitHub",
  adapter: "statuspage",
  baseUrl: "https://www.githubstatus.com",
  enabled: true,
  components: [],
  scopeToComponents: false,
};

const impact = (over: Partial<ServiceImpact> = {}): ServiceImpact => ({
  samples: 0,
  componentSamples: 0,
  incidents: 0,
  maintenances: 0,
  routingRules: 0,
  historyDays: 0,
  ...over,
});

const trigger = <Button type="button">{i18n.t("action.remove")}</Button>;

const open = async () => {
  await userEvent.click(screen.getByRole("button", { name: i18n.t("action.remove") }));
  return screen.findByRole("dialog");
};

describe("RemoveServiceDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names what the removal would take", async () => {
    renderWithProviders(<RemoveServiceDialog service={service} trigger={trigger} />, {
      serviceImpact: impact({ samples: 412, incidents: 3, historyDays: 90, routingRules: 1 }),
    });

    const dialog = await open();
    expect(
      await within(dialog).findByText(i18n.t("providers.remove-impact.history", { count: 90 })),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(i18n.t("providers.remove-impact.samples", { count: 412 })),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(i18n.t("providers.remove-impact.incidents", { count: 3 })),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(i18n.t("providers.remove-impact.rules", { count: 1 })),
    ).toBeInTheDocument();
  });

  it("leaves out what counts zero rather than reassuring with it", async () => {
    renderWithProviders(<RemoveServiceDialog service={service} trigger={trigger} />, {
      serviceImpact: impact({ samples: 5, historyDays: 1 }),
    });

    const dialog = await open();
    await within(dialog).findByText(i18n.t("providers.remove-impact.samples", { count: 5 }));
    expect(
      within(dialog).queryByText(i18n.t("providers.remove-impact.incidents", { count: 0 })),
    ).not.toBeInTheDocument();
  });

  it("says so plainly when there is nothing recorded yet", async () => {
    renderWithProviders(<RemoveServiceDialog service={service} trigger={trigger} />, {
      serviceImpact: impact(),
    });

    const dialog = await open();
    expect(
      await within(dialog).findByText(i18n.t("providers.remove-impact.empty")),
    ).toBeInTheDocument();
  });

  it("still lets the operator remove when the impact cannot be read", async () => {
    // The counts are documentation, not a precondition: a failing stat query
    // must not leave the operator unable to delete a provider.
    renderWithProviders(<RemoveServiceDialog service={service} trigger={trigger} />, {
      errors: { serviceImpact: 500 },
    });

    const dialog = await open();
    expect(within(dialog).getByText(i18n.t("providers.remove-confirm", { name: "GitHub" }))).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: i18n.t("action.remove") })).toBeEnabled();
  });
});
