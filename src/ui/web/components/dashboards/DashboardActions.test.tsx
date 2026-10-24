import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { createHashRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { createQueryClient } from "@/lib/queryClient.ts";
import { BusyProvider } from "@/hooks/useBusy.tsx";
import { ThemeProvider } from "@/hooks/useTheme.tsx";
import { DEFAULT_LAYOUT } from "../../../dashboardLayout.ts";
import { DashboardActions, dashboardCommand, freeName } from "./DashboardActions.tsx";

const t = i18n.t.bind(i18n);
const summary = (id: string, name: string, home = false) => ({ id, name, home, isDefault: true, updatedAt: "2026-10-01T00:00:00.000Z" });
const full = (id: string, name: string, home = false) => ({ ...summary(id, name, home), layout: DEFAULT_LAYOUT });

let list = [summary("default", "Overview", true), summary("il-mio-stack", "Il mio stack")];
let calls: { method: string; path: string; body: unknown }[] = [];

/** Answers by method and path, and records every write, so a test can say what was sent. */
function stub(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown);
      if (method !== "GET") calls.push({ method, path, body });
      const answer = (status: number, payload: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(payload) });
      if (path === "/dashboards" && method === "GET") return answer(200, list);
      if (path === "/dashboards" && method === "POST") {
        const name = (body as { name: string }).name;
        return answer(201, full("vendor-che-pago", name));
      }
      if (path === "/dashboards/restore") return answer(201, full("il-mio-stack", "Il mio stack"));
      if (method === "DELETE") {
        return answer(200, { id: "il-mio-stack", name: "Il mio stack", layout: null, position: 1, home: false });
      }
      if (path.startsWith("/dashboards/")) return answer(200, full("default", "Overview", true));
      return answer(200, { providers: [], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null });
    }),
  );
}

function mount(hash = "/overview/il-mio-stack") {
  window.location.hash = `#${hash}`;
  const client = createQueryClient({ retry: false });
  const router = createHashRouter([{ path: "*", element: <DashboardActions /> }]);
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <BusyProvider>
            <RouterProvider router={router} />
          </BusyProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

/** The list has to have answered before a command can name what it acts on. */
async function ready(): Promise<void> {
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([path]) => path === "/dashboards")).toBe(true));
  await act(async () => {});
}

beforeEach(() => {
  list = [summary("default", "Overview", true), summary("il-mio-stack", "Il mio stack")];
  calls = [];
  stub();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("freeName", () => {
  it("numbers a name that is taken, ignoring case", () => {
    expect(freeName("Ops", [summary("a", "ops"), summary("b", "Ops (2)")])).toBe("Ops (3)");
    expect(freeName("New", [summary("a", "Ops")])).toBe("New");
  });
});

describe("DashboardActions", () => {
  it("says a name is taken before asking the server, and sends nothing", async () => {
    mount();
    await ready();
    act(() => dashboardCommand({ kind: "create" }));
    fireEvent.change(await screen.findByLabelText(t("dashboards.name")), { target: { value: "  il MIO stack " } });
    fireEvent.click(screen.getByRole("button", { name: t("dashboards.create.confirm") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("dashboards.name-taken", { name: "il MIO stack" }));
    expect(screen.getByLabelText(t("dashboards.name"))).toHaveAttribute("aria-invalid", "true");
    expect(calls).toEqual([]);
  });

  it("creates an empty dashboard by default, opens it and says so", async () => {
    mount();
    await ready();
    act(() => dashboardCommand({ kind: "create" }));
    fireEvent.change(await screen.findByLabelText(t("dashboards.name")), { target: { value: "Vendor che pago" } });
    fireEvent.click(screen.getByRole("button", { name: t("dashboards.create.confirm") }));
    await waitFor(() => expect(window.location.hash).toBe("#/overview/vendor-che-pago"));
    expect(calls).toEqual([
      { method: "POST", path: "/dashboards", body: { name: "Vendor che pago", layout: { version: 1, widgets: [] } } },
    ]);
    expect(screen.getByRole("status")).toHaveTextContent(t("dashboards.done.created", { name: "Vendor che pago" }));
  });

  it("deletes after confirmation and offers Undo, which brings the same row back", async () => {
    mount();
    await ready();
    act(() => dashboardCommand({ kind: "delete", id: "il-mio-stack" }));
    expect(await screen.findByText(t("dashboards.delete.title", { name: "Il mio stack" }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("dashboards.delete.confirm") }));
    const undo = await screen.findByRole("button", { name: t("dashboards.undo") });
    expect(window.location.hash).toBe("#/overview");
    fireEvent.click(undo);
    await waitFor(() => expect(window.location.hash).toBe("#/overview/il-mio-stack"));
    expect(calls).toEqual([
      { method: "DELETE", path: "/dashboards/il-mio-stack", body: undefined },
      {
        method: "POST",
        path: "/dashboards/restore",
        body: { id: "il-mio-stack", name: "Il mio stack", layout: null, position: 1, home: false },
      },
    ]);
  });

  it("names a deleted home's successor in the confirmation", async () => {
    mount();
    await ready();
    act(() => dashboardCommand({ kind: "delete", id: "default" }));
    expect(await screen.findByText(new RegExp(t("dashboards.delete.home", { next: "Il mio stack" })))).toBeInTheDocument();
  });

  it("refuses a file that is not a dashboard export, before it is sent", async () => {
    mount();
    await ready();
    act(() => dashboardCommand({ kind: "import" }));
    const input = await screen.findByLabelText(t("dashboards.import.file"));
    const file = new File([JSON.stringify({ polling: {} })], "config.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(t("dashboards.import.not-export", { file: "config.json" }));
    expect(screen.getByRole("button", { name: t("dashboards.import.confirm") })).toBeDisabled();
    expect(calls).toEqual([]);
  });

  it("previews an export: its widgets, and the numbered name it will arrive under", async () => {
    mount();
    await ready();
    act(() => dashboardCommand({ kind: "import" }));
    const input = await screen.findByLabelText(t("dashboards.import.file"));
    const exported = { format: "isitdown.dashboard", version: 1, name: "Il mio stack", layout: DEFAULT_LAYOUT };
    fireEvent.change(input, { target: { files: [new File([JSON.stringify(exported)], "stack.json")] } });
    expect(
      await screen.findByText(t("dashboards.import.renamed", { name: "Il mio stack (2)" })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("dashboards.import.confirm") }));
    await waitFor(() => expect(calls).toEqual([{ method: "POST", path: "/dashboards/import", body: exported }]));
  });
});
