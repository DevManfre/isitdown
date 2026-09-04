import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n.ts";
import { useBusy } from "@/hooks/useBusy.tsx";
import { renderWithProviders } from "@/test/harness.tsx";
import { RoutingRulesDialog } from "./RoutingRulesDialog.tsx";

const channels = [{ id: "telegram", enabled: true, fields: [] }];
const services = [
  {
    id: "github",
    name: "GitHub",
    adapter: "statuspage",
    baseUrl: "https://www.githubstatus.com",
    enabled: true,
    components: [],
    scopeToComponents: false,
  },
];

describe("RoutingRulesDialog", () => {
  it("keeps the editor behind its trigger", () => {
    renderWithProviders(
      <RoutingRulesDialog routing={{ rules: [], invalidRules: 0 }} channels={channels} services={services} />,
    );
    expect(screen.getByRole("button", { name: i18n.t("action.edit-rules") })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the editor and titles it as the routing panel", async () => {
    renderWithProviders(
      <RoutingRulesDialog routing={{ rules: [], invalidRules: 0 }} channels={channels} services={services} />,
    );
    await userEvent.click(screen.getByRole("button", { name: i18n.t("action.edit-rules") }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(i18n.t("settings.routing"))).toBeInTheDocument();
  });

  it("holds the poll while the editor is open and releases it on close", async () => {
    // Asserting only that the dialog opens/closes would pass identically if
    // `setDialogOpen` were never wired to BusyContext at all. A probe mounted
    // alongside the dialog, inside the same BusyProvider renderWithProviders
    // sets up, reads the actual context value so the assertion is on
    // busy-ness itself, not on the dialog's visibility.
    function BusyProbe() {
      const busy = useBusy();
      return <span data-testid="busy-probe">{String(busy)}</span>;
    }

    renderWithProviders(
      <>
        <RoutingRulesDialog routing={{ rules: [], invalidRules: 0 }} channels={channels} services={services} />
        <BusyProbe />
      </>,
    );
    const probe = await screen.findByTestId("busy-probe");
    expect(probe).toHaveTextContent("false");

    await userEvent.click(screen.getByRole("button", { name: i18n.t("action.edit-rules") }));
    await screen.findByRole("dialog");
    expect(probe).toHaveTextContent("true");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(probe).toHaveTextContent("false");
  });
});
