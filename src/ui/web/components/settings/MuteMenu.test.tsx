import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import type { ServiceDefinition } from "@/lib/types.ts";
import { MuteMenu } from "./MuteMenu.tsx";

const service: ServiceDefinition = {
  id: "github",
  name: "GitHub",
  adapter: "statuspage",
  baseUrl: "https://www.githubstatus.com",
  enabled: true,
  components: [],
  scopeToComponents: false,
};

/** Records the write the menu sends and answers it, leaving refetches to the harness stub. */
function interceptPatch(): { path: string; body: { mutedUntil?: string | null } }[] {
  const calls: { path: string; body: { mutedUntil?: string | null } }[] = [];
  const base = globalThis.fetch as typeof fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      if ((init?.method ?? "GET") === "PATCH") {
        calls.push({ path, body: JSON.parse(String(init?.body)) as { mutedUntil?: string | null } });
        return { ok: true, status: 200, text: async (): Promise<string> => "{}" };
      }
      return base(input, init);
    }),
  );
  return calls;
}

describe("MuteMenu", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mutes a provider for the duration the operator picks", async () => {
    renderWithProviders(<MuteMenu service={service} />, {});
    const calls = interceptPatch();

    await userEvent.click(screen.getByRole("button", { name: i18n.t("action.mute") }));
    await userEvent.click(await screen.findByRole("menuitem", { name: i18n.t("mute.for-120") }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.path).toBe("/config/services/github");
    const until = Date.parse(String(calls[0]?.body.mutedUntil));
    // Two hours out, give or take the time the click took.
    expect(until - Date.now()).toBeGreaterThan(2 * 3600_000 - 60_000);
    expect(until - Date.now()).toBeLessThanOrEqual(2 * 3600_000);
  });

  it("offers to lift a running mute instead of setting another one", async () => {
    const muted = { ...service, mutedUntil: new Date(Date.now() + 3600_000).toISOString() };
    renderWithProviders(<MuteMenu service={muted} />, {});
    const calls = interceptPatch();

    expect(screen.queryByRole("button", { name: i18n.t("action.mute") })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: i18n.t("action.unmute") }));

    await waitFor(() => expect(calls).toHaveLength(1));
    // Null, not an expired timestamp: the patch schema reads null as "lift it".
    expect(calls[0]?.body.mutedUntil).toBeNull();
  });

  it("treats a mute that has already run out as no mute", async () => {
    const stale = { ...service, mutedUntil: new Date(Date.now() - 1000).toISOString() };
    renderWithProviders(<MuteMenu service={stale} />, {});

    expect(screen.getByRole("button", { name: i18n.t("action.mute") })).toBeInTheDocument();
  });
});
