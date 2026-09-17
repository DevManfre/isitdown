import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { Settings } from "@/views/Settings.tsx";

/**
 * Edit lives in the service row's own disclosure now — the row carries its
 * switch and nothing else until it is opened. Every test here that edits an
 * existing service opens the row first, the way an operator does.
 */
async function openEdit(name = "GitHub"): Promise<void> {
  const row = (await screen.findByText(name)).closest(".service-row") as HTMLElement;
  await userEvent.click(within(row).getByText(name));
  await userEvent.click(await screen.findByRole("button", { name: i18n.t("action.edit") }));
}

/**
 * Review Finding 2: the write path (add.mutateAsync, the post-add auto
 * test-connection, and ServiceDialog's own stay-open-on-failure) had no
 * coverage at all — only opening and closing was exercised.
 *
 * Takes over `fetch` once the dialog is already open, i.e. after
 * `renderWithProviders`'s own fixture-driven stub has already answered the
 * initial status/config load. Records every call so a test can assert on the
 * body a write actually sent, answers the specific write endpoints the test
 * cares about, and delegates anything else (a GET refetch triggered by a
 * mutation's own `invalidateQueries`) to the already-installed stub.
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
  renderWithProviders(<Settings />, fixtures, "/settings/services");
  const trigger = await screen.findByRole("button", { name: i18n.t("action.add-service") });
  await userEvent.click(trigger);
  return { trigger, dialog: await screen.findByRole("dialog") };
};

/** Step one is a choice between three named ways in; this picks one of them. */
const chooseSource = async (dialog: HTMLElement, label: string): Promise<void> => {
  await userEvent.click(within(dialog).getByRole("radio", { name: i18n.t(label) }));
};

/** Steps forward to the fields. Every add goes through here now. */
const goOn = async (dialog: HTMLElement): Promise<void> => {
  await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.continue") }));
};

/**
 * The shortest legal add: paste a url by hand, step on. Most write-path tests
 * only care about what the body looked like, not how the url got there.
 */
const addByUrl = async (dialog: HTMLElement, baseUrl: string): Promise<void> => {
  await chooseSource(dialog, "source.url");
  await userEvent.type(within(dialog).getByLabelText(i18n.t("field.base-url")), baseUrl);
  await goOn(dialog);
};

/**
 * Picks an adapter by hand, which is the one path that shows the whole list.
 * An empty `baseUrl` keeps whatever is already in the field — which is what a
 * test that has stepped back to change only the adapter wants.
 */
const addByAdapter = async (dialog: HTMLElement, adapter: string, baseUrl: string): Promise<void> => {
  await chooseSource(dialog, "source.manual");
  await userEvent.click(within(dialog).getByRole("radio", { name: adapter }));
  if (baseUrl !== "") await userEvent.type(within(dialog).getByLabelText(i18n.t("field.base-url")), baseUrl);
  await goOn(dialog);
};

/** The adapter's own fields live behind a disclosure on step two. */
const openAdvanced = async (dialog: HTMLElement): Promise<void> => {
  await userEvent.click(within(dialog).getByRole("button", { name: new RegExp(i18n.t("add.advanced")) }));
};

afterEach(() => vi.unstubAllGlobals());

describe("the service dialog's keyboard contract", () => {
  it("moves focus inside the dialog when it opens", async () => {
    const { dialog } = await openAdd();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("keeps Tab inside the dialog", async () => {
    const { dialog } = await openAdd();
    for (let i = 0; i < 12; i += 1) await userEvent.tab();
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
    await addByUrl(dialog, "https://status.example.com");
    const idField = within(dialog).getByLabelText(i18n.t("field.id"));
    expect(idField).toHaveAttribute("readonly");

    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.name")), "Città Cloud & Co.");

    expect(idField).toHaveValue("citta-cloud-co");
  });

  it("refuses to edit the id of an existing service", async () => {
    renderWithProviders(<Settings />, fixtures, "/settings/services");
    await openEdit();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(i18n.t("field.id"))).toHaveAttribute("readonly");
  });
});

/**
 * The half of the redesign that is structural rather than cosmetic: adding is
 * one decision followed by paperwork, so the decision gets a step of its own
 * and the paperwork cannot be reached until it is answered.
 */
describe("the service dialog's two steps", () => {
  it("opens on the source step, with the fields not yet on screen", async () => {
    const { dialog } = await openAdd();

    expect(within(dialog).getByRole("group", { name: i18n.t("catalog.label") })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(i18n.t("field.name"))).toBeNull();
  });

  it("will not step on until it has a base URL to step on with", async () => {
    const { dialog } = await openAdd();
    expect(within(dialog).getByRole("button", { name: i18n.t("action.continue") })).toBeDisabled();

    await chooseSource(dialog, "source.url");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.base-url")), "https://status.example.com");

    expect(within(dialog).getByRole("button", { name: i18n.t("action.continue") })).toBeEnabled();
  });

  // A form with a text field in it submits on Enter even with no submit button
  // on screen, which posted a nameless service and answered with the schema's
  // complaint about the id and the name — arriving, because the rejection is a
  // round trip, only once the operator had already stepped on.
  it("steps on when Enter is pressed in a field, rather than submitting a nameless service", async () => {
    const { dialog } = await openAdd();
    const calls = interceptWrites({});

    await chooseSource(dialog, "source.url");
    const url = within(dialog).getByLabelText(i18n.t("field.base-url"));
    await userEvent.type(url, "https://status.example.com{Enter}");

    expect(calls.filter((call) => call.method === "POST" && call.path === "/config/services")).toEqual([]);
    expect(within(dialog).getByLabelText(i18n.t("field.name"))).toBeInTheDocument();
  });

  it("carries the choice into the second step, and back out of it unchanged", async () => {
    const { dialog } = await openAdd();
    await addByAdapter(dialog, "rss", "https://status.example.com/history.rss");

    // The premise of every field below it, stated once at the top rather than
    // left to be read off a chip row.
    expect(within(dialog).getByText("https://status.example.com/history.rss")).toBeInTheDocument();
    expect(within(dialog).getByText("rss")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.change") }));

    expect(within(dialog).getByRole("radio", { name: "rss" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByLabelText(i18n.t("field.base-url"))).toHaveValue(
      "https://status.example.com/history.rss",
    );
  });

  // The rail is a React Bits stepper, whose circles are buttons. Only the one
  // behind the operator does anything: a circle that walked the wizard forward
  // would skip the source form the second step is built out of.
  it("steps back from the rail's first indicator, and offers no way forward from the second", async () => {
    const { dialog } = await openAdd();
    await addByAdapter(dialog, "rss", "https://status.example.com/history.rss");

    expect(within(dialog).queryByRole("button", { name: i18n.t("add.step-details") })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("add.step-source") }));

    expect(within(dialog).getByLabelText(i18n.t("field.base-url"))).toHaveValue(
      "https://status.example.com/history.rss",
    );
    expect(within(dialog).queryByLabelText(i18n.t("field.name"))).toBeNull();
  });
});

describe("the service dialog's adapter choice", () => {
  it("offers the feed adapter alongside the Statuspage one", async () => {
    const { dialog } = await openAdd();
    await chooseSource(dialog, "source.manual");
    expect(within(dialog).getByRole("radio", { name: "rss" })).toBeInTheDocument();
  });

  it("says what the base URL means for the adapter that is selected", async () => {
    const { dialog } = await openAdd();
    await chooseSource(dialog, "source.manual");
    expect(within(dialog).getByText(i18n.t("add.note.statuspage"))).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("radio", { name: "rss" }));

    expect(within(dialog).getByText(i18n.t("add.note.rss"))).toBeInTheDocument();
    expect(within(dialog).queryByText(i18n.t("add.note.statuspage"))).toBeNull();
  });

  // Roadmap 1.14. Nine adapters and nine base-url conventions: the page itself
  // knows which of them it is, so the form asks it rather than the operator.
  it("fills in the adapter and the base URL from the page itself", async () => {
    const { dialog } = await openAdd();
    await chooseSource(dialog, "source.url");
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
    expect(within(dialog).getByLabelText(i18n.t("field.base-url"))).toHaveValue(
      "https://status.example.com/history.rss",
    );

    // And the adapter it answered with is the one step two then proceeds on.
    await goOn(dialog);
    expect(within(dialog).getByText("rss")).toBeInTheDocument();
  });

  it("leaves the form alone when no adapter recognised the page", async () => {
    const { dialog } = await openAdd();
    await chooseSource(dialog, "source.url");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.base-url")), "https://example.com");

    interceptWrites({
      "POST /config/services/detect": { adapter: null, baseUrl: null, probes: [] },
    });
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.detect-adapter") }));

    expect(await within(dialog).findByText(i18n.t("add.detect-none"))).toBeInTheDocument();
    // The typing survives: the operator is about to pick an adapter by hand.
    expect(within(dialog).getByLabelText(i18n.t("field.base-url"))).toHaveValue("https://example.com");
  });

  it("submits the adapter the operator picked", async () => {
    const { dialog } = await openAdd();
    const calls = interceptWrites({
      "POST /config/services": {},
      "POST /config/services/feed-service/test": { ok: true, overallStatus: "operational" },
    });

    await addByAdapter(dialog, "rss", "https://status.example.com/history.rss");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.name")), "Feed Service");
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.add") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const addCall = calls.find((call) => call.method === "POST" && call.path === "/config/services");
    expect(addCall?.body).toMatchObject({ id: "feed-service", adapter: "rss" });
  });
});

describe("the service dialog's scrape adapter fields", () => {
  it("asks for a selector and warns about the reading breaking, only for the scrape adapter", async () => {
    const { dialog } = await openAdd();
    await addByUrl(dialog, "https://status.example.com");
    expect(within(dialog).queryByLabelText(i18n.t("scrape.selector"))).toBeNull();
    // A Statuspage site has no adapter fields at all, so there is no
    // disclosure to open for it either.
    expect(within(dialog).queryByRole("button", { name: new RegExp(i18n.t("add.advanced")) })).toBeNull();

    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.change") }));
    await addByAdapter(dialog, "html", "");
    await openAdvanced(dialog);

    expect(within(dialog).getByLabelText(i18n.t("scrape.selector"))).toBeInTheDocument();
    expect(within(dialog).getByText(i18n.t("scrape.warning"))).toBeInTheDocument();
  });

  it("submits the selector and only the status words the operator filled in", async () => {
    const { dialog } = await openAdd();
    const calls = interceptWrites({
      "POST /config/services": {},
      "POST /config/services/scraped/test": { ok: true, overallStatus: "operational" },
    });

    await addByAdapter(dialog, "html", "https://status.example.com/");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.name")), "Scraped");
    await openAdvanced(dialog);
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

describe("the service dialog's probe fields", () => {
  it("asks what a healthy answer looks like, only for the probe adapter", async () => {
    const { dialog } = await openAdd();
    await addByUrl(dialog, "https://app.example.com");
    expect(within(dialog).queryByLabelText(i18n.t("probe.expect-status"))).toBeNull();

    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.change") }));
    await addByAdapter(dialog, "http", "");
    await openAdvanced(dialog);

    expect(within(dialog).getByLabelText(i18n.t("probe.expect-status"))).toBeInTheDocument();
    expect(within(dialog).getByText(i18n.t("probe.warning"))).toBeInTheDocument();
  });

  it("offers no body match against a HEAD, which downloads no body", async () => {
    const { dialog } = await openAdd();
    await addByAdapter(dialog, "http", "https://app.example.com");
    await openAdvanced(dialog);
    expect(within(dialog).getByLabelText(i18n.t("probe.expect-body"))).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("radio", { name: "HEAD" }));

    expect(within(dialog).queryByLabelText(i18n.t("probe.expect-body"))).toBeNull();
  });

  it("submits the probe options, with the header folded under its own name", async () => {
    const { dialog } = await openAdd();
    const calls = interceptWrites({
      "POST /config/services": {},
      "POST /config/services/my-api/test": { ok: true, overallStatus: "operational" },
    });

    await addByAdapter(dialog, "http", "https://app.example.com");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.name")), "My API");
    await openAdvanced(dialog);
    await userEvent.type(within(dialog).getByLabelText(i18n.t("probe.path")), "/health");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("probe.expect-body")), "\"db\":\"up\"");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("probe.slow-ms")), "1500");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("probe.header-name")), "Authorization");
    // `{{` is how user-event types a literal brace: a bare `{` opens one of its
    // own key descriptors.
    await userEvent.type(within(dialog).getByLabelText(i18n.t("probe.header-value")), "Bearer ${{API_TOKEN}");

    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.add") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const addCall = calls.find((call) => call.method === "POST" && call.path === "/config/services");
    // The fields left alone are absent rather than sent as blanks, and the
    // secret travels as the `${VAR}` reference the operator typed — the value
    // itself is never stored here.
    expect(addCall?.body).toMatchObject({
      adapter: "http",
      options: {
        path: "/health",
        expectBody: "\"db\":\"up\"",
        slowMs: "1500",
        "header.Authorization": "Bearer ${API_TOKEN}",
      },
    });
    expect(Object.keys((addCall?.body as { options: Record<string, string> }).options)).not.toContain("expectStatus");
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

    await addByUrl(dialog, "https://example.com");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.name")), "New Service");
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
    // Review item 2: the only edit-mode test on record asserts the id field is
    // read-only but never actually submits — patch.mutateAsync and its body
    // have never been exercised until now.
    renderWithProviders(<Settings />, fixtures, "/settings/services");
    await openEdit();
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
      // Same for the group (roadmap 2.6): an empty field means "out of the
      // group", which only a null can say.
      group: null,
      // And for the SLA target (roadmap 4.13): an empty field means nobody is
      // promising anything about this provider any more.
      slaTarget: null,
    });
  });

  it("submits the poll interval the operator typed for this provider alone", async () => {
    const { dialog } = await openAdd();
    const calls = interceptWrites({
      "POST /config/services": {},
      "POST /config/services/new-service/test": { ok: true, overallStatus: "operational" },
    });

    await addByUrl(dialog, "https://example.com");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.name")), "New Service");
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

    await addByUrl(dialog, "https://example.com");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("field.name")), "New Service");
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.add") }));

    // The service was added; it simply did not answer. The dialog's own fix
    // over vanilla (which flashed the message then closed anyway) is to stay
    // open with the failure legible — assert that, not just that *a* dialog
    // exists.
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
    await goOn(dialog);

    expect(within(dialog).getByLabelText(i18n.t("field.name"))).toHaveValue("Heroku");
    expect(within(dialog).getByLabelText(i18n.t("field.id"))).toHaveValue("heroku");
    // The pick carries the adapter and the url the adapter wants, both of
    // which the second step states rather than asks for again.
    expect(within(dialog).getByText("https://status.heroku.com/feed")).toBeInTheDocument();
    expect(within(dialog).getByText("rss")).toBeInTheDocument();
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

  it("offers no catalog while editing: an existing service has every answer already", async () => {
    renderWithProviders(<Settings />, fixtures, "/settings/services");
    await openEdit();
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).queryByRole("group", { name: i18n.t("catalog.label") })).toBeNull();
    // And no step rail either: editing is one page, not half of a wizard.
    expect(within(dialog).queryByRole("button", { name: i18n.t("action.continue") })).toBeNull();
  });
});
