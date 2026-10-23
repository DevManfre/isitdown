import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { WIDGETS } from "@/widgets/registry.tsx";
import { DashboardGrid } from "./DashboardGrid.tsx";
import type { DashboardLayout } from "../../dashboardLayout.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const status = {
  providers: [
    providerFixture({ id: "github", name: "GitHub" }),
    providerFixture({ id: "aws", name: "AWS" }),
    providerFixture({ id: "stripe", name: "Stripe" }),
  ],
  groups: [{ id: "cloud", providers: ["aws"], status: "operational", affected: [] }],
  pollIntervalMinutes: 5,
  lastPollAt: null,
  nextPollAt: null,
};
const history = { aggregateUptime: 99.5, months: [], providers: [] };
const none = { groups: [], providers: [] };

function cells(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-slot=widget-cell]")];
}

describe("DashboardGrid", () => {
  it("spans six, four, three or two of six columns by width", async () => {
    const layout: DashboardLayout = {
      version: 1,
      widgets: [
        { id: "a", type: "fleet-list", width: "full", props: { filter: none } },
        { id: "b", type: "fleet-list", width: "two-thirds", props: { filter: none } },
        { id: "c", type: "fleet-list", width: "half", props: { filter: none } },
        { id: "d", type: "fleet-list", width: "third", props: { filter: none } },
      ],
    };
    const { container } = renderWithProviders(<DashboardGrid layout={layout} />, { status, history });
    await screen.findAllByText("GitHub");
    expect(cells(container).map((cell) => cell.className.split(" ").at(-1))).toEqual([
      "col-span-6",
      "md:col-span-4",
      "md:col-span-3",
      "md:col-span-2",
    ]);
  });

  it("leaves a widget that has nothing to draw with an empty body, so its cell collapses", async () => {
    const layout: DashboardLayout = {
      version: 1,
      widgets: [
        { id: "shared", type: "shared-failure", width: "full", props: {} },
        { id: "fleet", type: "fleet-list", width: "full", props: { filter: none } },
      ],
    };
    const { container } = renderWithProviders(<DashboardGrid layout={layout} />, { status, history });
    await screen.findByText("GitHub");
    const [shared] = cells(container);
    expect(shared?.querySelector("[data-slot=widget-body]")?.childElementCount).toBe(0);
    expect(shared?.className).toContain("has-[[data-slot=widget-body]:empty]:hidden");
  });

  it("captions a filtered widget with what it is filtered to, and leaves an unfiltered one bare", async () => {
    const layout: DashboardLayout = {
      version: 1,
      widgets: [
        { id: "all", type: "fleet-list", width: "half", props: { filter: none } },
        { id: "some", type: "fleet-list", width: "half", props: { filter: { groups: ["cloud"], providers: ["stripe"] } } },
      ],
    };
    const { container } = renderWithProviders(<DashboardGrid layout={layout} />, { status, history });
    await screen.findAllByText("AWS");
    const [all, some] = cells(container);
    expect(all?.querySelector("[data-slot=widget-caption]")).toBeNull();
    expect(some?.querySelector("[data-slot=widget-caption]")?.textContent).toBe(
      `${i18n.t("dashboard.widget.fleet-list.title")}cloud · Stripe`,
    );
    // The filtered list draws its slice and nothing else.
    expect(some?.textContent).toContain("AWS");
    expect(some?.textContent).not.toContain("GitHub");
  });

  it("says a filter matches nothing rather than drawing the whole fleet", async () => {
    const layout: DashboardLayout = {
      version: 1,
      widgets: [{ id: "gone", type: "fleet-list", width: "full", props: { filter: { groups: [], providers: ["heroku"] } } }],
    };
    renderWithProviders(<DashboardGrid layout={layout} />, { status, history });
    expect(await screen.findByText(i18n.t("dashboard.empty-slice"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("dashboard.filter.removed", { name: "heroku" }))).toBeInTheDocument();
    expect(screen.queryByText("GitHub")).toBeNull();
  });

  it("skips a widget type it does not know instead of failing the Overview", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const layout = {
      version: 1,
      widgets: [
        { id: "clock", type: "clock", width: "full", props: {} },
        { id: "fleet", type: "fleet-list", width: "full", props: { filter: none } },
      ],
    } as unknown as DashboardLayout;
    const { container } = renderWithProviders(<DashboardGrid layout={layout} />, { status, history });
    expect(await screen.findByText("GitHub")).toBeInTheDocument();
    expect(cells(container)).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("clock"));
  });

  it("keeps one broken widget to its own cell", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(WIDGETS["stack-band"], "Component").mockImplementation(() => {
      throw new Error("boom");
    });
    const layout: DashboardLayout = {
      version: 1,
      widgets: [
        { id: "stack", type: "stack-band", width: "full", props: { filter: none } },
        { id: "fleet", type: "fleet-list", width: "full", props: { filter: none } },
      ],
    };
    renderWithProviders(<DashboardGrid layout={layout} />, { status, history });
    expect(await screen.findByText(i18n.t("dashboard.widget-error", { error: "boom" }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: i18n.t("action.retry") })).toBeInTheDocument();
    expect(await screen.findByText("GitHub")).toBeInTheDocument();
  });
});
