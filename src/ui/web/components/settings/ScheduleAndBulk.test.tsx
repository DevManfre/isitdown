import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { Markdown } from "@/components/Markdown.tsx";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { Settings } from "@/views/Settings.tsx";

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

const service = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  adapter: "statuspage",
  baseUrl: `https://${id}.example.com`,
  enabled: true,
  components: [],
  scopeToComponents: false,
  ...over,
});

const fixtures = {
  config: {
    polling: { intervalMinutes: 5, requestTimeoutSeconds: 10, maxRetries: 3, failureThreshold: 3 },
    retention: { days: 120 },
    locale: "en",
    services: [
      service("github", "GitHub", { tags: ["paid"] }),
      service("vercel", "Vercel"),
      service("stripe", "Stripe", { tags: ["paid", "critical"] }),
    ],
    channels: [],
    routing: { rules: [], invalidRules: 0 },
  },
  status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
};

afterEach(() => vi.unstubAllGlobals());

const openRow = async (name: string): Promise<void> => {
  const row = (await screen.findByText(name)).closest(".service-row") as HTMLElement;
  await userEvent.click(within(row).getByText(name));
};

describe("planned mutes and declared maintenance (roadmap 5.2, 5.3)", () => {
  it("adds a weekly mute and a declared window, and saves both in one patch", async () => {
    renderWithProviders(<Settings />, fixtures, "/settings/services");
    await openRow("GitHub");
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("action.schedule") }));
    const dialog = await screen.findByRole("dialog");
    const calls = interceptWrites({ "PATCH /config/services/github": {} });

    // Asking for a mute with no day says why rather than adding nothing.
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("schedule.mute.add") }));
    expect(within(dialog).getByRole("alert").textContent).toBe(i18n.t("schedule.mute.need-days"));

    const days = within(dialog).getByLabelText(i18n.t("schedule.mute.days"));
    await userEvent.click(within(days).getAllByRole("button")[1]!);
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("schedule.mute.add") }));
    expect(within(dialog).queryByText(i18n.t("schedule.mute.empty"))).toBeNull();

    await userEvent.type(within(dialog).getByLabelText(i18n.t("schedule.window.title")), "Deploy");
    const starts = within(dialog).getAllByLabelText(i18n.t("schedule.from")).at(-1)!;
    const ends = within(dialog).getAllByLabelText(i18n.t("schedule.until")).at(-1)!;
    await userEvent.type(starts, "2026-12-01T10:00");
    await userEvent.type(ends, "2026-12-01T11:00");
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("schedule.window.add") }));

    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("action.save") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const patch = calls.find((call) => call.method === "PATCH")?.body as {
      muteSchedules: { days: string[]; start: string; end: string }[];
      maintenanceWindows: { title: string; startsAt: string; endsAt: string }[];
    };
    expect(patch.muteSchedules).toEqual([expect.objectContaining({ days: ["tue"], start: "02:00", end: "04:00" })]);
    expect(patch.maintenanceWindows).toEqual([
      {
        title: "Deploy",
        startsAt: new Date("2026-12-01T10:00").toISOString(),
        endsAt: new Date("2026-12-01T11:00").toISOString(),
      },
    ]);
  });

  it("a window ending before it starts is refused with the reason, on the field", async () => {
    renderWithProviders(<Settings />, fixtures, "/settings/services");
    await openRow("GitHub");
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("action.schedule") }));
    const dialog = await screen.findByRole("dialog");
    const starts = within(dialog).getAllByLabelText(i18n.t("schedule.from")).at(-1)!;
    const ends = within(dialog).getAllByLabelText(i18n.t("schedule.until")).at(-1)!;
    await userEvent.type(starts, "2026-12-01T11:00");
    await userEvent.type(ends, "2026-12-01T10:00");
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("schedule.window.add") }));
    expect(within(dialog).getByRole("alert").textContent).toBe(i18n.t("schedule.need-order"));
    expect(ends.getAttribute("aria-invalid")).toBe("true");
    expect(within(dialog).getByRole("button", { name: i18n.t("action.save") })).toHaveProperty("disabled", true);
  });
});

describe("bulk edit (roadmap 5.5)", () => {
  it("edits only the selected providers, and only the fields that were touched", async () => {
    renderWithProviders(<Settings />, fixtures, "/settings/services");
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("bulk.start") }));
    await userEvent.click(screen.getByRole("checkbox", { name: i18n.t("bulk.select", { name: "GitHub" }) }));
    await userEvent.click(screen.getByRole("checkbox", { name: i18n.t("bulk.select", { name: "Vercel" }) }));
    await userEvent.click(screen.getByRole("button", { name: i18n.t("bulk.edit", { count: 2 }) }));
    const dialog = await screen.findByRole("dialog");
    const calls = interceptWrites({ "PATCH /config/services": { services: [] } });

    // Nothing touched, nothing to apply.
    expect(within(dialog).getByRole("button", { name: i18n.t("bulk.apply", { count: 2 }) })).toHaveProperty(
      "disabled",
      true,
    );
    await userEvent.type(within(dialog).getByLabelText(i18n.t("bulk.add-tags")), "Critical");
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("bulk.apply", { count: 2 }) }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({
      ids: ["github", "vercel"],
      patch: {},
      addTags: ["critical"],
      removeTags: [],
    });
  });

  it("filters the list by a tag", async () => {
    renderWithProviders(<Settings />, fixtures, "/settings/services");
    await userEvent.click(await screen.findByRole("button", { name: "#critical" }));
    expect(screen.queryByText("GitHub")).toBeNull();
    expect(screen.getByText("Stripe")).toBeTruthy();
  });
});

describe("runbook Markdown (roadmap 5.1)", () => {
  it("renders headings, lists, emphasis and http links, and nothing else as a link", () => {
    render(
      <Markdown
        source={"## If it is down\n- Switch to **EU**\n- See [the wiki](https://wiki.example.com/gh)\n\n[evil](javascript:alert(1)) my_var_name"}
      />,
    );
    expect(screen.getByText("If it is down")).toBeTruthy();
    expect(screen.getByText("EU").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "the wiki" }).getAttribute("href")).toBe("https://wiki.example.com/gh");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText(/my_var_name/)).toBeTruthy();
  });
});
