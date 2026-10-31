import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { CommandPalette } from "@/components/CommandPalette.tsx";
import { ShortcutsDialog } from "@/components/ShortcutsDialog.tsx";
import { renderWithProviders } from "@/test/harness.tsx";
import { useShortcuts } from "./useShortcuts.ts";

afterEach(() => vi.unstubAllGlobals());

function Shell() {
  useShortcuts();
  return (
    <>
      <CommandPalette />
      <ShortcutsDialog />
      <input aria-label="a field" />
    </>
  );
}

const render = () =>
  renderWithProviders(<Shell />, {
    status: { providers: [], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
  });

describe("useShortcuts", () => {
  it("goes to the view a g sequence names", async () => {
    render();
    const user = userEvent.setup();
    await user.keyboard("gi");
    await waitFor(() => expect(window.location.hash).toBe("#/incidents"));
  });

  it("opens the map of shortcuts on ?, listing every one", async () => {
    render();
    const user = userEvent.setup();
    await user.keyboard("?");
    const dialog = await screen.findByRole("dialog", { name: i18n.t("shortcuts.title") });
    for (const key of ["shortcuts.go-incidents", "shortcuts.search", "shortcuts.poll", "shortcuts.help"]) {
      expect(dialog).toHaveTextContent(i18n.t(key));
    }
  });

  it("opens the palette on /", async () => {
    render();
    const user = userEvent.setup();
    await user.keyboard("/");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("asks the server to poll on p", async () => {
    render();
    const user = userEvent.setup();
    await user.keyboard("p");
    await waitFor(() => {
      const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit?][];
      expect(calls.some(([url, init]) => String(url).includes("poll") && init?.method === "POST")).toBe(true);
    });
  });

  it("does nothing while the operator is typing in a field", async () => {
    render();
    const user = userEvent.setup();
    await user.click(screen.getByRole("textbox", { name: "a field" }));
    await user.keyboard("gi?/");
    expect(window.location.hash).not.toBe("#/incidents");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does nothing behind an open dialog", async () => {
    render();
    const user = userEvent.setup();
    await user.keyboard("?");
    await screen.findByRole("dialog");
    window.location.hash = "#/";
    await user.keyboard("gi");
    expect(window.location.hash).toBe("#/");
  });
});
