import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import { HistoryDialog } from "./HistoryDialog.tsx";
import { SnapshotsDialog } from "./SnapshotsDialog.tsx";

type Call = { path: string; method: string; body?: unknown };

/** Answers the routes these dialogs use, recording every call; everything else falls through to the harness. */
function serve(answers: Record<string, unknown | (() => unknown)>): Call[] {
  const calls: Call[] = [];
  const base = globalThis.fetch as typeof fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      const key = `${method} ${path}`;
      if (!Object.hasOwn(answers, key)) return base(input, init);
      calls.push({ path, method, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      const answer = answers[key];
      const body = typeof answer === "function" ? (answer as () => unknown)() : answer;
      return { ok: true, status: body === undefined ? 204 : 200, text: async () => (body === undefined ? "" : JSON.stringify(body)) };
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const diff = {
  services: { added: ["vercel"], removed: [], changed: [] },
  settings: [],
  channels: [],
  routing: null,
  recipients: null,
  empty: false,
};

describe("SnapshotsDialog (roadmap 5.8)", () => {
  it("says there are none, saves one by name, and lists it", async () => {
    let snapshots: unknown[] = [];
    renderWithProviders(<SnapshotsDialog />);
    const calls = serve({
      "GET /config/snapshots": () => ({ snapshots }),
      "POST /config/snapshots": () => {
        snapshots = [{ id: 1, name: "before-the-migration", createdAt: new Date().toISOString(), services: 3 }];
        return snapshots[0];
      },
    });

    await userEvent.click(screen.getByRole("button", { name: i18n.t("config.snapshots.open") }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(i18n.t("config.snapshots.empty"))).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText(i18n.t("config.snapshots.name")), "before-the-migration");
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("config.snapshots.save") }));

    expect(await within(dialog).findByText("before-the-migration")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ name: "before-the-migration" });
  });

  it("shows what a restore would change and only restores on confirmation", async () => {
    const snapshots = [{ id: 7, name: "baseline", createdAt: new Date().toISOString(), services: 2 }];
    renderWithProviders(<SnapshotsDialog />);
    const calls = serve({
      "GET /config/snapshots": { snapshots },
      "GET /config/snapshots/7/preview": diff,
      "POST /config/snapshots/7/restore": {
        report: { added: ["vercel"], updated: [], removed: [], channels: [], routingRules: 0, settings: [] },
        safety: { id: 8, name: "Before restoring baseline 2026-11-06T12:00:00Z", createdAt: "", services: 1 },
      },
    });

    await userEvent.click(screen.getByRole("button", { name: i18n.t("config.snapshots.open") }));
    const list = await screen.findByRole("dialog");
    await userEvent.click(await within(list).findByRole("button", { name: i18n.t("action.restore") }));

    const review = (await screen.findAllByRole("dialog")).at(-1) as HTMLElement;
    expect(await within(review).findByTestId("config-diff")).toBeInTheDocument();
    expect(within(review).getByText("vercel")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    await userEvent.click(within(review).getByRole("button", { name: i18n.t("config.snapshots.restore.confirm") }));
    await waitFor(() => expect(calls.some((c) => c.path === "/config/snapshots/7/restore")).toBe(true));
    // The way back is named in the result.
    expect(await screen.findByText(/Before restoring baseline/)).toBeInTheDocument();
  });
});

describe("HistoryDialog (roadmap 5.7)", () => {
  const entry = {
    id: 4,
    at: "2026-11-06T10:00:00.000Z",
    actor: "alice",
    method: "PATCH",
    route: "/config/settings",
    kind: "setting",
    target: "settings",
    field: "intervalMinutes",
    before: 3,
    after: 7,
    revertible: true,
  };

  it("says nothing was recorded yet", async () => {
    renderWithProviders(<HistoryDialog />);
    serve({ "GET /config/history?limit=200": { entries: [] } });
    await userEvent.click(screen.getByRole("button", { name: i18n.t("config.history.open") }));
    expect(await screen.findByText(i18n.t("config.history.empty"))).toBeInTheDocument();
  });

  it("lists who changed what, writes the old value back on request, and offers no restore for a credential", async () => {
    renderWithProviders(<HistoryDialog />);
    const calls = serve({
      "GET /config/history?limit=200": {
        entries: [
          entry,
          { ...entry, id: 5, kind: "credential", target: "telegram", field: "botToken", before: null, after: "set", revertible: false },
        ],
      },
      "POST /config/history/4/revert": { reverted: entry },
    });

    await userEvent.click(screen.getByRole("button", { name: i18n.t("config.history.open") }));
    const dialog = await screen.findByRole("dialog");

    expect(await within(dialog).findByText("3 → 7")).toBeInTheDocument();
    expect(within(dialog).getAllByText(/alice/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(i18n.t("config.history.credential-set"))).toBeInTheDocument();
    expect(within(dialog).getAllByRole("button", { name: /Restore the previous value/ })).toHaveLength(1);

    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("config.history.restore-label", { target: "settings", field: "intervalMinutes" }) }));
    await waitFor(() => expect(calls.some((c) => c.path === "/config/history/4/revert")).toBe(true));
    expect(await within(dialog).findByText(i18n.t("config.history.restored"))).toBeInTheDocument();
  });
});
