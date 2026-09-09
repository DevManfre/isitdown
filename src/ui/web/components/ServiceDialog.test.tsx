import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { Settings } from "@/views/Settings.tsx";

/**
 * Review Finding 2: the write path (add.mutateAsync, the post-add auto
 * test-connection, ServiceDialog's own stay-open-on-failure) had no
 * coverage at all — only opening/closing was exercised.
 *
 * Takes over `fetch` once the dialog is already open, i.e. after
 * `renderWithProviders`'s own fixture-driven stub already answered the
 * initial status/config load. Records every call so a test can assert on
 * the body a write actually sent, answers the specific write endpoints a
 * test cares about, and delegates anything else (a GET refetch triggered by
 * a mutation's own `invalidateQueries`) to that already-installed stub.
 */
type RecordedCall = { path: string; method: string; body?: unknown };

function interceptWrites(responses: Record<string, unknown>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const base = globalThis.fetch as typeof fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ path, method, body });
      const key = `${method} ${path}`;
      if (Object.hasOwn(responses, key)) {
        return { ok: true, status: 200, text: async () => JSON.stringify(responses[key]) };
      }
      return base(input, init);
    }),
  );
  return calls;
}

const config = {
  polling: { intervalMinutes: 5, requestTimeoutSeconds: 10, maxRetries: 3, failureThreshold: 3 },
  retention: { days: 120 },
  locale: "en",
  services: [
    {
      id: "github",
      name: "GitHub",
      adapter: "statuspage",
      baseUrl: "https://www.githubstatus.com",
      enabled: true,
      components: [],
      scopeToComponents: false,
    },
  ],
  channels: [],
  routing: { rules: [], invalidRules: 0 },
};
const catalog = {
  providers: [
    { id: "vercel", name: "Vercel", adapter: "statuspage", baseUrl: "https://www.vercel-status.com", configured: false },
    { id: "heroku", name: "Heroku", adapter: "rss", baseUrl: "https://status.heroku.com/feed", configured: false },
    { id: "github", name: "GitHub", adapter: "statuspage", baseUrl: "https://www.githubstatus.com", configured: true },
  ],
};
const fixtures = {
  config,
  catalog,
  status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
  componentHistory: { provider: "github", days: 90, components: [] },
};

const openAdd = async () => {
  renderWithProviders(<Settings />, fixtures);
  const trigger = await screen.findByRole("button", { name: i18n.t("action.add-service") });
  await userEvent.click(trigger);
  return { trigger, dialog: await screen.findByRole("dialog") };
};

afterEach(() => vi.unstubAllGlobals());

describe("the service dialog's keyboard contract", () => {
  it("moves focus inside the dialog when it opens", async () => {
    const { dialog } = await openAdd();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("keeps Tab inside the dialog", async () => {
    const { dialog } = await openAdd();
    const focusable = within(dialog).getAllByRole("textbox");
    for (let i = 0; i < focusable.length + 3; i += 1) await userEvent.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("closes on Escape", async () => {
    await openAdd();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("returns focus to whatever opened it", async () => {
    const { trigger } = await openAdd();
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
  });

  it("derives the id from the name instead of asking for it", async () => {
    const { dialog } = await openAdd();
    const idField = within(dialog).getByLabelText(i18n.t("field.id"));

    expect(idField).toHaveAttribute("readonly");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.name")), "Città Cloud & Co.");

    expect(idField).toHaveValue("citta-cloud-co");
  });

  it("refuses to edit the id of an existing service", async () => {
    renderWithProviders(<Settings />, fixtures);
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("action.edit") }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(i18n.t("field.id"))).toHaveAttribute("readonly");
  });
});

describe("the service dialog's adapter choice", () => {
  it("offers the feed adapter alongside the Statuspage one", async () => {
    const { dialog } = await openAdd();
    expect(within(dialog).getByRole("radio", { name: "rss" })).toBeInTheDocument();
  });

  it("says what the base URL means for the adapter that is selected", async () => {
    const { dialog } = await openAdd();
    expect(within(dialog).getByText(i18n.t("add.note.statuspage"))).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("radio", { name: "rss" }));

    expect(within(dialog).getByText(i18n.t("add.note.rss"))).toBeInTheDocument();
    expect(within(dialog).queryByText(i18n.t("add.note.statuspage"))).toBeNull();
  });

  // Roadmap 1.14. Nine adapters and nine base-url conventions: the page itself
  // knows which of them it is, so the form asks it rather than the operator.
  it("fills in the adapter and the base URL from the page itself", async () => {
    const { dialog } = await openAdd();
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.base-url")), "status.example.com");

    interceptWrites({
      "POST /config/services/detect": {
        adapter: "rss",
        baseUrl: "https://status.example.com/history.rss",
        probes: [{ adapter: "rss", url: "https://status.example.com/history.rss", outcome: "match" }],
      },
    });
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.detect-adapter") }));

    expect(await within(dialog).findByText(i18n.t("add.detect-ok", { adapter: "rss" }))).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "rss" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByLabelText(i18n.t("field.base-url"))).toHaveValue(
      "https://status.example.com/history.rss",
    );
  });

  it("leaves the form alone when no adapter recognised the page", async () => {
    const { dialog } = await openAdd();
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.base-url")), "https://example.com");

    interceptWrites({
      "POST /config/services/detect": { adapter: null, baseUrl: null, probes: [] },
    });
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.detect-adapter") }));

    expect(await within(dialog).findByText(i18n.t("add.detect-none"))).toBeInTheDocument();
    // The typing survives: the operator is about to pick an adapter by hand.
    expect(within(dialog).getByLabelText(i18n.t("field.base-url"))).toHaveValue("https://example.com");
    expect(within(dialog).getByRole("radio", { name: "statuspage" })).toHaveAttribute("aria-checked", "true");
  });

  it("submits the adapter the operator picked", async () => {
    const { dialog } = await openAdd();
    const calls = interceptWrites({
      "POST /config/services": {},
      "POST /config/services/feed-service/test": { ok: true, overallStatus: "operational" },
    });

    await userEvent.click(within(dialog).getByRole("radio", { name: "rss" }));
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.name")), "Feed Service");
    await userEvent.type(
      within(dialog).getByLabelText(i18n.t("field.base-url")),
      "https://status.example.com/history.rss",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.add") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const addCall = calls.find((call) => call.method === "POST" && call.path === "/config/services");
    expect(addCall?.body).toMatchObject({ id: "feed-service", adapter: "rss" });
  });
});

describe("the service dialog's scrape adapter fields", () => {
  it("asks for a selector and warns about the reading breaking, only for the scrape adapter", async () => {
    const { dialog } = await openAdd();
    expect(within(dialog).queryByLabelText(i18n.t("scrape.selector"))).toBeNull();

    await userEvent.click(within(dialog).getByRole("radio", { name: "html" }));

    expect(within(dialog).getByLabelText(i18n.t("scrape.selector"))).toBeInTheDocument();
    expect(within(dialog).getByText(i18n.t("scrape.warning"))).toBeInTheDocument();
  });

  it("submits the selector and only the status words the operator filled in", async () => {
    const { dialog } = await openAdd();
    const calls = interceptWrites({
      "POST /config/services": {},
      "POST /config/services/scraped/test": { ok: true, overallStatus: "operational" },
    });

    await userEvent.click(within(dialog).getByRole("radio", { name: "html" }));
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.name")), "Scraped");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.base-url")), "https://status.example.com/");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("scrape.selector")), ".status-banner");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("status.operational")), "tutto tranquillo");

    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.add") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const addCall = calls.find((call) => call.method === "POST" && call.path === "/config/services");
    // The severities left empty are absent rather than sent as blanks: a blank
    // would be stored as a mapping that matches nothing.
    expect(addCall?.body).toMatchObject({
      adapter: "html",
      options: { selector: ".status-banner", operational: "tutto tranquillo" },
    });
  });
});

describe("the service dialog's write path", () => {
  it("a successful add calls the mutation with the expected body, component selection included", async () => {
    const { dialog } = await openAdd();
    const calls = interceptWrites({
      "POST /config/services/preview-components": {
        supported: true,
        components: [{ id: "c1", name: "Component One", group: null }],
      },
      "POST /config/services": {},
      "POST /config/services/new-service/test": { ok: true, overallStatus: "operational" },
    });

    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.name")), "New Service");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.base-url")), "https://example.com");
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("components.load") }));
    await userEvent.click(await within(dialog).findByLabelText("Component One"));

    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.add") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const addCall = calls.find((call) => call.method === "POST" && call.path === "/config/services");
    expect(addCall?.body).toEqual({
      id: "new-service",
      name: "New Service",
      adapter: "statuspage",
      baseUrl: "https://example.com",
      enabled: true,
      components: [{ id: "c1", name: "Component One" }],
      scopeToComponents: false,
    });
  });

  it("a successful edit submits the patch mutation with the expected body", async () => {
    // Review item 2: the only edit-mode test on record (line ~98) asserts
    // the id field is read-only but never actually submits — patch.mutateAsync
    // and its body have never been exercised until now.
    renderWithProviders(<Settings />, fixtures);
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("action.edit") }));
    const dialog = await screen.findByRole("dialog");
    const calls = interceptWrites({ "PATCH /config/services/github": {} });

    const nameInput = within(dialog).getByLabelText(i18n.t("field.name"));
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "GitHub Renamed");

    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.save") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const patchCall = calls.find((call) => call.method === "PATCH" && call.path === "/config/services/github");
    expect(patchCall?.body).toEqual({
      name: "GitHub Renamed",
      baseUrl: "https://www.githubstatus.com",
      components: [],
      scopeToComponents: false,
      // An empty interval field is the provider following the global cadence,
      // and only a null says so on a patch.
      intervalMinutes: null,
    });
  });

  it("submits the poll interval the operator typed for this provider alone", async () => {
    const { dialog } = await openAdd();
    const calls = interceptWrites({
      "POST /config/services": {},
      "POST /config/services/new-service/test": { ok: true, overallStatus: "operational" },
    });

    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.name")), "New Service");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.base-url")), "https://example.com");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.provider-interval")), "45");
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.add") }));

    await waitFor(() => {
      const post = calls.find((call) => call.method === "POST" && call.path === "/config/services");
      expect((post?.body as { intervalMinutes?: number })?.intervalMinutes).toBe(45);
    });
  });

  it("a failed connection test leaves the dialog open, with the failure message shown", async () => {
    const { dialog } = await openAdd();
    interceptWrites({
      "POST /config/services": {},
      "POST /config/services/new-service/test": { ok: false, error: "connection refused" },
    });

    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.name")), "New Service");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.base-url")), "https://example.com");
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.add") }));

    // The service was added; it simply did not answer. The dialog's own
    // fix over vanilla (which flashed the message then closed anyway) is
    // to stay open with the failure legible — assert that, not just that
    // *a* dialog exists.
    expect(
      await within(dialog).findByText(i18n.t("add.test-failed", { error: "connection refused" })),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBe(dialog);
  });
});

// Roadmap 5.11. A first run starts with a name ("I want to watch Vercel"),
// not with a url, which is the half detection cannot cover.
describe("the service dialog's bundled catalog", () => {
  it("fills in the name, the adapter and the base URL from one pick", async () => {
    const { dialog } = await openAdd();
    const menu = within(await within(dialog).findByRole("group", { name: i18n.t("catalog.label") }));

    await userEvent.click(await menu.findByRole("button", { name: "Heroku" }));

    expect(within(dialog).getByLabelText(i18n.t("field.name"))).toHaveValue("Heroku");
    expect(within(dialog).getByLabelText(i18n.t("field.id"))).toHaveValue("heroku");
    expect(within(dialog).getByLabelText(i18n.t("field.base-url"))).toHaveValue("https://status.heroku.com/feed");
    // The pick carries the adapter too, so the base-url hint is the feed one.
    expect(within(dialog).getByRole("radio", { name: "rss" })).toHaveAttribute("data-state", "on");
  });

  it("keeps an already-watched provider listed, but not pickable", async () => {
    const { dialog } = await openAdd();
    const menu = within(await within(dialog).findByRole("group", { name: i18n.t("catalog.label") }));

    // Listed, so the menu never looks like it forgot GitHub — and disabled,
    // because adding it again would only earn a 409.
    expect(await menu.findByRole("button", { name: "GitHub" })).toBeDisabled();
    expect(menu.getByRole("button", { name: "Vercel" })).toBeEnabled();
  });

  it("filters the menu by name, and says so when nothing matches", async () => {
    const { dialog } = await openAdd();
    const menu = () => within(within(dialog).getByRole("group", { name: i18n.t("catalog.label") }));
    expect(await menu().findByRole("button", { name: "Vercel" })).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText(i18n.t("catalog.search-label")), "her");

    await waitFor(() => expect(menu().queryByRole("button", { name: "Vercel" })).toBeNull());
    expect(menu().getByRole("button", { name: "Heroku" })).toBeInTheDocument();

    await userEvent.clear(within(dialog).getByLabelText(i18n.t("catalog.search-label")));
    await userEvent.type(within(dialog).getByLabelText(i18n.t("catalog.search-label")), "zzz");

    expect(await within(dialog).findByText(i18n.t("catalog.empty"))).toBeInTheDocument();
  });

  it("offers no menu while editing: an existing service has every answer already", async () => {
    renderWithProviders(<Settings />, fixtures);
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("action.edit") }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).queryByRole("group", { name: i18n.t("catalog.label") })).toBeNull();
  });
});
