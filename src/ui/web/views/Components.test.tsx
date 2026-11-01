import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { Components } from "./Components.tsx";

/** Roadmap 4.23: every component of every provider, in one list. */

afterEach(() => vi.unstubAllGlobals());

const status = {
  providers: [
    providerFixture({
      id: "github",
      name: "GitHub",
      components: [
        { id: "api", name: "API Requests", status: "operational" },
        { id: "actions", name: "Actions", status: "major_outage" },
      ],
    }),
    providerFixture({
      id: "aws",
      name: "AWS",
      components: [
        { id: "ec2-eu-west-1", name: "EC2 eu-west-1", status: "degraded" },
        { id: "s3-us-east-1", name: "S3 us-east-1", status: "operational" },
      ],
    }),
  ],
  groups: [],
  pollIntervalMinutes: 5,
  lastPollAt: null,
  nextPollAt: null,
};

const names = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[1]?.textContent);

describe("Components", () => {
  it("lists every provider's components, worst first, each status in words", async () => {
    renderWithProviders(<Components />, { status }, "/components");
    await screen.findByRole("table");
    // Same status: by provider (AWS before GitHub), then by component.
    expect(names()).toEqual(["Actions", "EC2 eu-west-1", "S3 us-east-1", "API Requests"]);
    const [first] = screen.getAllByRole("row").slice(1);
    expect(first).toHaveTextContent(i18n.t("status.major-outage"));
    expect(within(first!).getByRole("link", { name: /GitHub/ })).toHaveAttribute("href", "#/providers/github");
  });

  it("filters by text across component and provider names", async () => {
    renderWithProviders(<Components />, { status }, "/components");
    await userEvent.type(await screen.findByRole("searchbox"), "eu-west");
    expect(names()).toEqual(["EC2 eu-west-1"]);
    await userEvent.clear(screen.getByRole("searchbox"));
    await userEvent.type(screen.getByRole("searchbox"), "github");
    expect(names()).toEqual(["Actions", "API Requests"]);
  });

  it("filters by status and names a filter that leaves nothing, with a way out", async () => {
    renderWithProviders(<Components />, { status }, "/components", "/components?status=unknown");
    expect(
      await screen.findByText(i18n.t("components.filtered.status", { status: i18n.t("components.filter.unknown") })),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: i18n.t("components.filtered.clear") }));
    expect(names()).toHaveLength(4);
  });

  it("keeps a typed trailing space while the address catches up", async () => {
    renderWithProviders(<Components />, { status }, "/components");
    const box = await screen.findByRole("searchbox");
    await userEvent.type(box, "eu ");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(box).toHaveValue("eu ");
    await userEvent.type(box, "w");
    expect(box).toHaveValue("eu w");
  });

  it("names both filters when together they leave nothing", async () => {
    renderWithProviders(<Components />, { status }, "/components", "/components?status=ok&q=Actions");
    expect(
      await screen.findByText(i18n.t("components.filtered.both", { query: "Actions", status: i18n.t("components.filter.ok") })),
    ).toBeInTheDocument();
  });

  it("explains a fleet with no components and leads to the providers", async () => {
    renderWithProviders(
      <Components />,
      { status: { ...status, providers: [providerFixture({ components: [] })] } },
      "/components",
    );
    expect(await screen.findByText(i18n.t("components.none.title"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: i18n.t("components.none.action") })).toHaveAttribute("href", "#/providers");
  });

  it("shows the page's shape while /status is on its way, never the empty state", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    renderWithProviders(<Components />, {}, "/components");
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    expect(screen.getByRole("status", { busy: true })).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("components.none.title"))).not.toBeInTheDocument();
  });
});
