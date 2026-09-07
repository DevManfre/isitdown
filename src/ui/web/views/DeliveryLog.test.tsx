import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import type { SentRecord } from "@/lib/types.ts";
import { DeliveryLog } from "./DeliveryLog.tsx";

/** Matches a filter radio by the start of its name; the count rides along in it. */
const radioNamed = (label: string) => ({
  name: (accessibleName: string) => accessibleName.startsWith(label),
});

const failed: SentRecord = {
  providerId: "github",
  channel: "telegram",
  kind: "status_change",
  text: "🔴 GitHub is down\nWas: operational",
  sentAt: "2026-09-07T14:02:11Z",
  ok: false,
  error: "401 Unauthorized — bot token rejected",
};

const sent: SentRecord = {
  providerId: "github",
  channel: "webhook",
  kind: "status_change",
  text: "🔴 GitHub is down\nWas: operational",
  sentAt: "2026-09-07T14:02:11Z",
  ok: true,
};

const status = { providers: [providerFixture()], pollIntervalMinutes: 3 };
const config = {
  services: [],
  polling: { intervalMinutes: 3, requestTimeoutSeconds: 8, maxRetries: 3, failureThreshold: 5 },
  channels: [
    { id: "telegram", enabled: true, fields: [] },
    { id: "webhook", enabled: true, fields: [] },
  ],
  routing: { rules: [], invalid: 0 },
};

/** The log answers by query string, so the fixture is a function of the path. */
const log = (rows: SentRecord[], counts = { all: 2, sent: 1, failed: 1 }) => (path: string) => {
  const state = new URL(`http://localhost${path}`).searchParams.get("state");
  const channel = new URL(`http://localhost${path}`).searchParams.get("channel");
  const items = rows
    .filter((row) => state === null || (state === "failed" ? !row.ok : row.ok))
    .filter((row) => channel === null || row.channel === channel);
  return { page: { items, page: 1, pageSize: 25, total: items.length }, counts };
};

/** The outcome pills, scoped: "All" also starts the channel filter's own option. */
const outcomes = () => within(screen.getByRole("radiogroup", { name: i18n.t("delivery.filter.state") }));
// The channel filter appears once the configuration lands: an installation with
// no channels gets no filter at all.
const channelFilter = async () =>
  within(await screen.findByRole("radiogroup", { name: i18n.t("delivery.filter.channel") }));

/** The row list, so a badge query cannot match the state pill of the same word. */
const rows = () => within(screen.getByRole("region", { name: i18n.t("delivery.rows") }));

const render = (rows: SentRecord[] = [failed, sent], counts?: { all: number; sent: number; failed: number }) =>
  renderWithProviders(<DeliveryLog />, { status, config, deliveryLog: log(rows, counts) });

describe("DeliveryLog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens on the failed sends, because that is the question the view answers", async () => {
    render();

    // The failed pill is the selected one on arrival, and the failed send is
    // the row on screen — an operator must not have to know to filter for it.
    expect(await outcomes().findByRole("radio", radioNamed(i18n.t("delivery.state.failed")))).toBeChecked();
    expect(await rows().findByText(i18n.t("delivery.result.failed"))).toBeInTheDocument();
    expect(rows().queryByText(i18n.t("delivery.result.sent"))).not.toBeInTheDocument();
  });

  it("shows every outcome's count while one of them is on screen", async () => {
    render([failed, sent], { all: 12, sent: 9, failed: 3 });
    const pill = (label: string) => outcomes().getByRole("radio", radioNamed(label));

    // Wait for the page itself, then read the pills: the counts arrive with it.
    await rows().findByText(i18n.t("delivery.result.failed"));

    // All three counts, though only the failed slice is on screen — derived from
    // the loaded rows they would report the page size instead.
    expect(pill(i18n.t("delivery.state.all"))).toHaveTextContent("12");
    expect(pill(i18n.t("delivery.state.sent"))).toHaveTextContent("9");
    expect(pill(i18n.t("delivery.state.failed"))).toHaveTextContent("3");
  });

  it("asks the server for the sent slice rather than re-filtering the page", async () => {
    render();
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: [string][] } };

    await userEvent.click(await outcomes().findByRole("radio", radioNamed(i18n.t("delivery.state.sent"))));

    // The delivered row replaces the failed one, and it came from a fresh
    // request rather than from the page already loaded.
    expect(await rows().findByText(i18n.t("delivery.result.sent"))).toBeInTheDocument();
    expect(rows().queryByText(i18n.t("delivery.result.failed"))).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => String(path).includes("state=sent"))).toBe(true);
  });

  it("narrows to one channel through the query too", async () => {
    render();

    await userEvent.click((await channelFilter()).getByRole("radio", radioNamed("telegram")));

    const fetchMock = globalThis.fetch as unknown as { mock: { calls: [string][] } };
    expect(fetchMock.mock.calls.some(([path]) => String(path).includes("channel=telegram"))).toBe(true);
  });

  it("expands a row to the payload that was sent and the provider's own error", async () => {
    render();

    const row = await rows().findByRole("button", { name: (name) => name.includes("GitHub") });
    expect(within(row).queryByText("Was: operational", { exact: false })).not.toBeInTheDocument();

    await userEvent.click(row);

    // The full text, not the headline the feed panel shows.
    expect(await screen.findByText(/Was: operational/)).toBeInTheDocument();
    expect(row).toHaveAttribute("aria-expanded", "true");
  });

  it("says that nothing failed rather than showing a blank panel", async () => {
    render([], { all: 4, sent: 4, failed: 0 });

    expect(await screen.findByText(i18n.t("delivery.empty-failed"))).toBeInTheDocument();
  });
});
