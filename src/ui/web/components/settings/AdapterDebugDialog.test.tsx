import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import { AdapterDebugDialog } from "./AdapterDebugDialog.tsx";
import type { ServiceDefinition } from "@/lib/types.ts";

const service: ServiceDefinition = {
  id: "acme",
  name: "Acme",
  adapter: "html",
  baseUrl: "https://status.acme.test",
  enabled: true,
  components: [],
  scopeToComponents: false,
  options: { selector: ".status-banner" },
};

/** What `GET /debug/adapters` answers: one provider, one failed read. */
const adapterDebug = {
  providers: [
    {
      id: "acme",
      name: "Acme",
      adapter: "html",
      baseUrl: "https://status.acme.test",
      enabled: true,
      options: { selector: ".status-banner" },
      probes: [
        {
          at: "2026-09-08T12:00:00.000Z",
          ok: false,
          attempts: 3,
          durationMs: 812,
          error: "html fetch for acme failed: HTTP 503",
        },
        { at: "2026-09-08T11:57:00.000Z", ok: true, attempts: 1, durationMs: 96, notModified: true },
      ],
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

/** Opens the dialog, which is where every assertion below lives. */
async function open(fixtures: Parameters<typeof renderWithProviders>[1] = {}): Promise<HTMLElement> {
  renderWithProviders(<AdapterDebugDialog service={service} />, fixtures);
  await userEvent.click(screen.getByRole("button", { name: i18n.t("action.debug-adapter") }));
  return await screen.findByRole("dialog");
}

describe("AdapterDebugDialog", () => {
  it("shows the adapter, its options and the recent reads", async () => {
    const dialog = await open({ adapterDebug });

    expect(within(dialog).getByText(/html · https:\/\/status\.acme\.test/)).toBeTruthy();
    expect(within(dialog).getByText(/selector=\.status-banner/)).toBeTruthy();
    // The error in full: it is what the container logs were being read for.
    expect(await within(dialog).findByText(/HTTP 503/)).toBeTruthy();
    // And the 304, so "answered instantly" and "we never asked" stay apart.
    expect(within(dialog).getByText(i18n.t("adapter.debug.not-modified"))).toBeTruthy();
  });

  it("says so plainly when nothing has been polled yet", async () => {
    const dialog = await open({ adapterDebug: { providers: [] } });
    expect(await within(dialog).findByText(i18n.t("adapter.debug.empty"))).toBeTruthy();
  });

  it("reads the page on demand and reports what the adapter made of it", async () => {
    const dialog = await open({ adapterDebug });

    const base = globalThis.fetch as typeof fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (String(input) === "/debug/adapters/acme/probe") {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                durationMs: 120,
                status: {
                  overallStatus: "degraded",
                  activeIncidents: [],
                  components: [],
                  maintenances: [],
                  fetchedAt: "2026-09-08T12:01:00.000Z",
                },
              }),
          };
        }
        return base(input, init);
      }),
    );

    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("adapter.debug.probe") }));

    const result = await screen.findByTestId("adapter-probe-result");
    await waitFor(() => expect(result.textContent).toContain(i18n.t("status.degraded")));
  });

  it("calls out a read that parsed into nothing, which is what a stale selector looks like", async () => {
    const dialog = await open({ adapterDebug });

    const base = globalThis.fetch as typeof fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        if (String(input) === "/debug/adapters/acme/probe") {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                durationMs: 120,
                status: {
                  overallStatus: "unknown",
                  activeIncidents: [],
                  components: [],
                  maintenances: [],
                  fetchedAt: "2026-09-08T12:01:00.000Z",
                },
              }),
          };
        }
        return base(input, init);
      }),
    );

    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("adapter.debug.probe") }));

    expect(await screen.findByText(i18n.t("adapter.debug.unknown-warning"))).toBeTruthy();
  });

  // Roadmap 5.13: the diagnose dialog is reachable and escapable by keyboard,
  // shown rather than assumed from "it is a Radix dialog".
  it("takes focus, keeps Tab inside, and hands focus back on Escape", async () => {
    renderWithProviders(<AdapterDebugDialog service={service} />, { adapterDebug });
    const trigger = screen.getByRole("button", { name: i18n.t("action.debug-adapter") });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");

    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    for (let i = 0; i < 6; i += 1) await userEvent.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
