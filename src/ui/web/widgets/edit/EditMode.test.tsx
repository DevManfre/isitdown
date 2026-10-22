import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { Overview } from "@/views/Overview.tsx";
import { DEFAULT_LAYOUT, type DashboardLayout } from "../../../dashboardLayout.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
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
const dashboard = (layout: DashboardLayout = DEFAULT_LAYOUT, updatedAt = "2026-10-22T10:00:00.000Z") => ({
  id: "default",
  name: "Overview",
  layout,
  isDefault: layout === DEFAULT_LAYOUT,
  updatedAt,
});

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/**
 * The harness answers every request from fixtures by path alone; a save is a
 * PUT and a reset a DELETE on the same path, so those are answered here and
 * everything else falls through to the harness.
 */
function stubWrites(answer: (call: Call) => { status: number; body: unknown }): Call[] {
  const calls: Call[] = [];
  const reads = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return reads(input, init);
      const call = { method, path: String(input), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) };
      calls.push(call);
      const { status: code, body } = answer(call);
      return { ok: code < 400, status: code, text: async () => JSON.stringify(body) };
    }),
  );
  return calls;
}

const t = (key: string, values: Record<string, unknown> = {}) => i18n.t(key, values);
const name = (type: string) => t(`dashboard.widget.${type}.title`);

async function openEditor(layout?: DashboardLayout) {
  renderWithProviders(<Overview />, { status, history, dashboard: dashboard(layout) }, "/");
  fireEvent.click(await screen.findByRole("button", { name: t("dashboard.customise") }));
  const list = await screen.findByRole("list", { name: t("dashboard.edit.list-label") });
  await screen.findAllByRole("button", { name: new RegExp(`^${t("dashboard.move", { widget: "" })}`) });
  return list;
}

const order = (list: HTMLElement) =>
  within(list)
    .getAllByRole("listitem")
    .map((cell) => cell.getAttribute("data-widget"));

describe("Overview edit mode", () => {
  it("opens on Customise, behind ?edit=1, with a toolbar on every widget and the hero marked fixed", async () => {
    const list = await openEditor();
    expect(window.location.hash).toContain("edit=1");
    expect(order(list)).toEqual(["fleet-rings", "geo-map", "shared-failure", "stack-band", "fleet-list"]);
    for (const type of ["fleet-rings", "geo-map", "fleet-list"]) {
      expect(screen.getByRole("button", { name: t("dashboard.remove", { widget: name(type) }) })).toBeInTheDocument();
    }
    expect(screen.getByText(t("dashboard.hero-fixed"))).toBeInTheDocument();
  });

  it("explains a widget with nothing to draw today instead of hiding it", async () => {
    const list = await openEditor();
    const shared = within(list).getAllByRole("listitem")[2]!;
    expect(within(shared).getByText(t("dashboard.widget.shared-failure.idle"))).toBeInTheDocument();
  });

  it("moves a widget with the arrow keys on its grip, announces it and keeps focus on it", async () => {
    const list = await openEditor();
    const grip = screen.getByRole("button", { name: t("dashboard.move", { widget: name("geo-map") }) });
    grip.focus();
    fireEvent.keyDown(grip, { key: "ArrowUp" });
    expect(order(list).slice(0, 2)).toEqual(["geo-map", "fleet-rings"]);
    expect(screen.getByText(t("dashboard.announce.moved", { widget: name("geo-map"), position: 1, total: 5 }))).toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: t("dashboard.move", { widget: name("geo-map") }) }),
      ),
    );
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(order(list).at(-1)).toBe("geo-map");
  });

  it("offers only the widths a widget can take", async () => {
    await openEditor();
    const map = screen.getAllByRole("radiogroup", { name: t("dashboard.width.label") })[1]!;
    expect(within(map).getByRole("radio", { name: t("dashboard.width.third") })).toBeDisabled();
    fireEvent.click(within(map).getByRole("radio", { name: t("dashboard.width.half") }));
    expect(within(map).getByRole("radio", { name: t("dashboard.width.half") })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(t("dashboard.bar.dirty"))).toBeInTheDocument();
  });

  it("filters a fleet widget by group and says so in its toolbar", async () => {
    await openEditor();
    const filterButton = screen.getByRole("button", { name: t("dashboard.filter.button", { widget: name("fleet-list") }) });
    fireEvent.click(filterButton);
    expect(filterButton).toHaveAttribute("aria-expanded", "true");
    const groups = screen.getByRole("toolbar", { name: t("dashboard.filter.groups") });
    fireEvent.click(within(groups).getByRole("button", { name: "cloud" }));
    expect(screen.getByText(t("dashboard.announce.filter", { widget: name("fleet-list"), filter: "cloud" }))).toBeInTheDocument();
  });

  it("strikes a filtered provider the fleet no longer has, and drops it on one press", async () => {
    const orphan: DashboardLayout = {
      version: 1,
      widgets: [{ id: "f", type: "fleet-list", width: "full", props: { filter: { groups: [], providers: ["heroku"] } } }],
    };
    await openEditor(orphan);
    fireEvent.click(screen.getByRole("button", { name: t("dashboard.filter.button", { widget: name("fleet-list") }) }));
    const providers = screen.getByRole("toolbar", { name: t("dashboard.filter.providers") });
    const removed = within(providers).getByRole("button", { name: t("dashboard.filter.removed", { name: "heroku" }) });
    expect(removed.className).toContain("line-through");
    fireEvent.click(removed);
    expect(within(providers).queryByRole("button", { name: t("dashboard.filter.removed", { name: "heroku" }) })).toBeNull();
  });

  it("adds a widget from the catalogue at the end and hands it focus", async () => {
    const list = await openEditor();
    fireEvent.click(screen.getByRole("button", { name: t("dashboard.add") }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: new RegExp(name("stack-band")) }));
    await waitFor(() => expect(order(list)).toHaveLength(6));
    expect(order(list).at(-1)).toBe("stack-band");
    await waitFor(() => expect(document.activeElement?.getAttribute("data-grip")).toBe("stack-band-1"));
  });

  it("asks before throwing a dirty draft away, and leaves edit mode once told to", async () => {
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: t("dashboard.remove", { widget: name("geo-map") }) }));
    fireEvent.click(screen.getByRole("button", { name: t("action.cancel") }));
    const dialog = await screen.findByRole("dialog", { name: t("dashboard.discard.title") });
    fireEvent.click(within(dialog).getByRole("button", { name: t("dashboard.discard.confirm") }));
    await waitFor(() => expect(screen.queryByRole("list", { name: t("dashboard.edit.list-label") })).toBeNull());
    expect(window.location.hash).not.toContain("edit=1");
  });

  it("leaves at once on Cancel when nothing changed", async () => {
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: t("action.cancel") }));
    await waitFor(() => expect(screen.queryByRole("list", { name: t("dashboard.edit.list-label") })).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("saves the draft against the version it started from, then confirms", async () => {
    await openEditor();
    const calls = stubWrites((call) => ({
      status: 200,
      body: dashboard((call.body as { layout: DashboardLayout }).layout, "2026-10-22T11:00:00.000Z"),
    }));
    fireEvent.click(screen.getByRole("button", { name: t("dashboard.remove", { widget: name("geo-map") }) }));
    fireEvent.click(screen.getByRole("button", { name: t("action.save") }));
    await waitFor(() => expect(screen.getByText(t("dashboard.saved"))).toBeInTheDocument());
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.body).toMatchObject({ updatedAt: "2026-10-22T10:00:00.000Z" });
    expect((calls[0]?.body as { layout: DashboardLayout }).layout.widgets.map((w) => w.type)).not.toContain("geo-map");
    await waitFor(() => expect(screen.queryByRole("list", { name: t("dashboard.edit.list-label") })).toBeNull());
  });

  it("keeps the draft and says why when a save fails", async () => {
    await openEditor();
    stubWrites(() => ({ status: 500, body: { error: { message: "disk full" } } }));
    fireEvent.click(screen.getByRole("button", { name: t("dashboard.remove", { widget: name("geo-map") }) }));
    fireEvent.click(screen.getByRole("button", { name: t("action.save") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("dashboard.save-failed", { error: "disk full" }));
    expect(screen.getByRole("list", { name: t("dashboard.edit.list-label") })).toBeInTheDocument();
  });

  it("offers both copies when someone else saved first, and loads theirs on request", async () => {
    const list = await openEditor();
    const theirs: DashboardLayout = { version: 1, widgets: [DEFAULT_LAYOUT.widgets[4]!] };
    stubWrites(() => ({
      status: 409,
      body: { error: { message: "saved elsewhere" }, current: dashboard(theirs, "2026-10-22T10:30:00.000Z") },
    }));
    fireEvent.click(screen.getByRole("button", { name: t("dashboard.remove", { widget: name("geo-map") }) }));
    fireEvent.click(screen.getByRole("button", { name: t("action.save") }));
    const banner = await screen.findByRole("alert");
    expect(within(banner).getByRole("button", { name: t("dashboard.conflict.mine") })).toBeInTheDocument();
    fireEvent.click(within(banner).getByRole("button", { name: t("dashboard.conflict.theirs") }));
    // The cells theirs does not have leave through their exit animation.
    await waitFor(() => expect(order(list)).toEqual(["fleet-list"]));
    expect(screen.getByText(t("dashboard.bar.clean"))).toBeInTheDocument();
  });

  it("resets to the default only after confirming", async () => {
    const custom: DashboardLayout = { version: 1, widgets: [DEFAULT_LAYOUT.widgets[4]!] };
    await openEditor(custom);
    const calls = stubWrites(() => ({ status: 200, body: dashboard() }));
    fireEvent.click(screen.getByRole("button", { name: t("dashboard.reset") }));
    const dialog = await screen.findByRole("dialog", { name: t("dashboard.reset.title") });
    expect(calls).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: t("dashboard.reset.confirm") }));
    await waitFor(() => expect(calls[0]?.method).toBe("DELETE"));
    await waitFor(() => expect(screen.getByText(t("dashboard.reset-done"))).toBeInTheDocument());
  });

  it("guards leaving the Overview with unsaved changes", async () => {
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: t("dashboard.remove", { widget: name("geo-map") }) }));
    fireEvent.click(screen.getByRole("button", { name: t("action.history-90d") }));
    const dialog = await screen.findByRole("dialog", { name: t("dashboard.leave.title") });
    fireEvent.click(within(dialog).getByRole("button", { name: t("dashboard.leave.stay") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("list", { name: t("dashboard.edit.list-label") })).toBeInTheDocument();
  });

  it("hands focus to the first widget on the way in, back to Customise on the way out, and says it is editing", async () => {
    await openEditor();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: t("dashboard.move", { widget: name("fleet-rings") }) }),
      ),
    );
    expect(await screen.findByText(t("dashboard.edit.entered", { count: 5 }))).toBeInTheDocument();
    expect(screen.getByRole("region", { name: t("dashboard.bar.label") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("action.cancel") }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: t("dashboard.customise") })),
    );
  });

  it("starts a draft from the saved layout, never from the placeholder shown while it loads", async () => {
    const custom: DashboardLayout = { version: 1, widgets: [DEFAULT_LAYOUT.widgets[4]!, DEFAULT_LAYOUT.widgets[0]!] };
    let answer: (value: unknown) => void = () => {};
    const late = new Promise((resolve) => {
      answer = resolve;
    });
    // A bookmarked ?edit=1, landing before the layout does.
    renderWithProviders(<Overview />, { status, history, dashboard: () => late }, "/", "/?edit=1");
    await screen.findByText(t("overview.title.all-operational"));
    expect(screen.queryByRole("list", { name: t("dashboard.edit.list-label") })).toBeNull();
    answer(dashboard(custom));
    const list = await screen.findByRole("list", { name: t("dashboard.edit.list-label") });
    expect(order(list)).toEqual(["fleet-list", "fleet-rings"]);
    // Loaded straight into edit mode: no control vanished, so focus stays put.
    await screen.findAllByRole("button", { name: new RegExp(`^${t("dashboard.move", { widget: "" })}`) });
    expect(document.activeElement).toBe(document.body);
  });

  it("says so when the layout cannot be loaded, offers a retry, and does not offer to customise", async () => {
    renderWithProviders(<Overview />, { status, history, errors: { dashboard: 500 } }, "/");
    expect(await screen.findByRole("alert")).toHaveTextContent(t("dashboard.load-failed", { error: "HTTP 500" }));
    expect(screen.getByRole("button", { name: t("action.retry") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("dashboard.customise") })).toBeNull();
    // The Overview still draws, from the default layout.
    expect(screen.getAllByText("GitHub").length).toBeGreaterThan(0);
  });
});
