import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { InstallHealth } from "@/components/settings/InstallHealth.tsx";
import { renderWithProviders } from "@/test/harness.tsx";

afterEach(() => vi.unstubAllGlobals());

const ok = (id: string) => ({ id, state: "ok", fix: "/settings/data" });

describe("InstallHealth", () => {
  it("shows a skeleton, not the all-good sentence, while the checklist loads", () => {
    renderWithProviders(
      <InstallHealth />,
      { installHealth: new Promise(() => {}) },
    );
    expect(screen.queryByText("Everything on the installation checklist is in order.")).toBeNull();
  });

  it("says so in one sentence when everything is in order", async () => {
    renderWithProviders(
      <InstallHealth />,
      { installHealth: { abandoned: [], checks: [ok("channels"), ok("backup")] } },
    );
    expect(await screen.findByText("Everything on the installation checklist is in order.")).toBeTruthy();
  });

  it("lists only what needs attention, counts the rest, and links each fix", async () => {
    renderWithProviders(
      <InstallHealth />,
      {
        installHealth: {
          abandoned: [],
          checks: [
            ok("channels"),
            { id: "backup", state: "warn", fix: "/settings/data" },
            { id: "channel-test", state: "warn", fix: "/settings/notifications", days: 120 },
          ],
        },
      },
    );
    expect(await screen.findByText("No backup has been downloaded from this installation.")).toBeTruthy();
    expect(screen.getByText("No notification channel has been tested for 120 days.")).toBeTruthy();
    expect(screen.getByText("1 of 3 checks in order")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "Fix" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "#/settings/data",
      "#/settings/notifications",
    ]);
  });

  it("an unknown check is listed but not counted as in order", async () => {
    renderWithProviders(
      <InstallHealth />,
      {
        installHealth: {
          abandoned: [],
          checks: [ok("channels"), { id: "version", state: "unknown", fix: "/settings/data" }],
        },
      },
    );
    expect(await screen.findByText("1 of 2 checks in order")).toBeTruthy();
    expect(
      screen.getByText("Whether a newer version exists isn't being checked. Turn on update checks to find out."),
    ).toBeTruthy();
  });

  it("names each abandoned provider and sends the operator to Services, never removing anything itself", async () => {
    renderWithProviders(
      <InstallHealth />,
      {
        installHealth: {
          abandoned: [
            { id: "old", name: "Old Co", reason: "disabled", since: "2026-01-01T00:00:00Z" },
            { id: "dead", name: "Dead Co", reason: "failing", since: "2026-01-02T00:00:00Z" },
          ],
          checks: [ok("channels")],
        },
      },
    );
    expect(await screen.findByText(/Old Co has been switched off since/)).toBeTruthy();
    expect(screen.getByText(/Dead Co hasn't been read successfully since/)).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "Review in Services" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link.getAttribute("href")).toBe("#/settings/services");
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.every(([, init]) => init?.method === undefined || init.method === "GET")).toBe(true);
  });

  it("an external fix opens the manual in a new tab", async () => {
    renderWithProviders(
      <InstallHealth />,
      {
        installHealth: {
          abandoned: [],
          checks: [{ id: "token", state: "warn", fix: "https://example.com/manual" }],
        },
      },
    );
    const link = await screen.findByRole("link", { name: "Fix" });
    expect(link.getAttribute("href")).toBe("https://example.com/manual");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("a failed load says so with a retry, not the all-good sentence", async () => {
    renderWithProviders(
      <InstallHealth />,
      { errors: { installHealth: 500 } },
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("Everything on the installation checklist is in order.")).toBeNull();
  });
});
