import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import type { CatalogFeedStatus } from "@/lib/types.ts";
import { CatalogUpdatesRow } from "./CatalogUpdatesRow.tsx";

afterEach(() => vi.unstubAllGlobals());

const status = (over: Partial<CatalogFeedStatus> = {}): CatalogFeedStatus => ({
  enabled: true,
  status: "updated",
  source: "remote",
  generatedAt: "2026-10-10T00:00:00.000Z",
  entries: 204,
  checkedAt: new Date().toISOString(),
  ...over,
});

const proposal = {
  serviceId: "github",
  name: "GitHub",
  from: { adapter: "statuspage", baseUrl: "https://status.github.com" },
  to: { adapter: "statuspage", baseUrl: "https://www.githubstatus.com" },
};

const mount = (feed: CatalogFeedStatus | undefined, onToggle = vi.fn()) => {
  renderWithProviders(<CatalogUpdatesRow status={feed} onToggle={onToggle} />, {
    catalog: (path: string) => (path.endsWith("/proposals") ? { proposals: [proposal] } : { providers: [] }),
  });
  return onToggle;
};

/** Every write the row made, as method and path. */
const writes = (): string[] =>
  (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit | undefined][])
    .filter(([, init]) => init?.method !== undefined && init.method !== "GET")
    .map(([path, init]) => `${init?.method} ${path} ${typeof init?.body === "string" ? init.body : ""}`.trim());

describe("catalog updates in Settings", () => {
  it("is a switch that is off by default and asks for nothing while off", async () => {
    const onToggle = mount(status({ enabled: false }));
    const toggle = screen.getByRole("switch", { name: i18n.t("field.catalog-feed") });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(i18n.t("field.catalog-feed.hint"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("settings.catalog-feed.proposal", { name: "GitHub" }))).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("lists a moved provider and accepts it as an ordinary service edit", async () => {
    mount(status());
    expect(await screen.findByText(i18n.t("settings.catalog-feed.proposal", { name: "GitHub" }))).toBeInTheDocument();
    expect(screen.getByText("status.github.com → www.githubstatus.com")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.catalog-feed.apply") }));
    await waitFor(() =>
      expect(writes()).toContain(
        'PATCH /config/services/github {"adapter":"statuspage","baseUrl":"https://www.githubstatus.com"}',
      ),
    );
  });

  it("turns a proposal down through its own route", async () => {
    mount(status());
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("settings.catalog-feed.dismiss") }));
    await waitFor(() => expect(writes()).toContain("POST /config/catalog/proposals/github/dismiss"));
  });

  it("says when the last check failed", () => {
    mount(status({ status: "failed" }));
    expect(screen.getByText(i18n.t("settings.catalog-feed.status.failed"))).toBeInTheDocument();
  });
});
