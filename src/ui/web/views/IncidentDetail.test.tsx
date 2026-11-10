import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { IncidentDetail } from "./IncidentDetail.tsx";

const detail = {
  incident: { providerId: "github", incidentId: "i1", name: "API errors", impact: "major",
              status: "monitoring", startedAt: "2026-08-21T09:00:00Z",
              updatedAt: "2026-08-21T09:30:00Z", resolvedAt: null },
  timeline: [
    { at: "2026-08-21T09:00:00Z", label: "opened", status: "investigating" },
    { at: "2026-08-21T09:15:00Z", label: "observed", status: "major_outage" },
  ],
  // Field names follow the real SentRecord (lib/types.ts), not a guess:
  // `channel` (not channelId), `text` (not title), `sentAt` (not at), `ok` (not delivered).
  actionLog: [{ providerId: "github", channel: "telegram", kind: "incident_opened" as const,
                text: "GitHub — MAJOR OUTAGE", sentAt: "2026-08-21T09:01:00Z", ok: true }],
  polls: [{ observedAt: "2026-08-21T09:20:00Z", overallStatus: "major_outage" as const, ok: true }],
  otherActiveIncidents: [],
  // Roadmap 5.3: the operator's own account of the incident, which the detail
  // payload carries beside the two IsItDown writes itself.
  notes: [{ id: 1, body: "Our deploy failed on this.", createdAt: "2026-08-21T09:05:00Z" }],
};

const mount = () =>
  renderWithProviders(<IncidentDetail />, {
    incident: detail,
    status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
  }, "/incidents/:providerId/:incidentId");

/** The same fixture, plus the map snapshot and the preference that reveals it. */
const mountWithMap = () =>
  renderWithProviders(<IncidentDetail />, {
    incident: detail,
    status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
    map: {
      points: [{ providerId: "github", providerName: "GitHub", componentId: "github/api",
                 name: "Ashburn", lat: 39.02, lon: -77.46, status: "operational", source: "iata" }],
      unlocated: [],
      generatedAt: "2026-08-21T09:30:00Z",
    },
    preferences: { theme: "dark", uiLocale: "en", notificationLocale: "en", mapView: "map", density: "comfortable" },
  }, "/incidents/:providerId/:incidentId");


const STATUS = { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null };
const mountWith = (over: Record<string, unknown>) =>
  renderWithProviders(<IncidentDetail />, { incident: { ...detail, ...over }, status: STATUS },
    "/incidents/:providerId/:incidentId");
const okPoll = (minute: number) => ({
  observedAt: `2026-08-21T09:${String(minute).padStart(2, "0")}:00Z`, overallStatus: "operational" as const, ok: true,
});

afterEach(() => vi.unstubAllGlobals());

describe("IncidentDetail", () => {
  it("titles the incident and names its provider", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: "API errors" })).toBeInTheDocument();
    expect(await screen.findAllByText(/GitHub/)).not.toHaveLength(0);
  });

  it("offers a way back to the overview", async () => {
    mount();
    const link = await screen.findByRole("link", { name: new RegExp(i18n.t("action.back")) });
    // The dashboard routes on the hash.
    expect(link).toHaveAttribute("href", "#/overview");
  });

  // Roadmap 6.4: the postmortem is the server's document, reached by a plain link —
  // behind the menu, since it is not what most visits are for.
  it("offers the incident as a downloadable postmortem, in the menu", async () => {
    mount();
    expect(screen.queryByRole("menuitem")).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("incident.menu.label") }));
    const link = await screen.findByRole("menuitem", { name: i18n.t("action.download-postmortem") });
    expect(link).toHaveAttribute("href", expect.stringMatching(/^\/incidents\/[^/]+\/[^/]+\/postmortem\.md$/));
    expect(screen.getByRole("menuitem", { name: i18n.t("action.copy-payload") })).toBeInTheDocument();
  });
});

describe("the verdict", () => {
  it("says an open incident is still affecting the provider, and what was sent", async () => {
    mount();
    expect(await screen.findByText(i18n.t("incident.verdict.active.title", { provider: "GitHub" }))).toBeInTheDocument();
  });

  it("says when an alert failed to send, rather than leaving it in a count", async () => {
    mountWith({ actionLog: [{ ...detail.actionLog[0], ok: false, error: "403" }] });
    expect(await screen.findByText(i18n.t("incident.verdict.detail.failed", { count: 1 }))).toBeInTheDocument();
  });

  it("explains an open incident the provider reads fine on, instead of leaving green beside 'Investigating'", async () => {
    mountWith({ polls: [okPoll(30), okPoll(27), okPoll(24), okPoll(21)] });
    expect(await screen.findByText(i18n.t("incident.verdict.recovered.title", { provider: "GitHub" }))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("incident.verdict.recovered.detail", { count: 4, provider: "GitHub" }))).toBeInTheDocument();
  });

  it("reports a resolved incident with how long it lasted", async () => {
    mountWith({ incident: { ...detail.incident, status: "resolved", resolvedAt: "2026-08-21T10:30:00Z" } });
    expect(await screen.findByText(/Resolved after/)).toBeInTheDocument();
  });
});

describe("the incident's own figures", () => {
  it("says how long it has run and how many sends went out", async () => {
    mount();
    const stats = await screen.findByTestId("incident-stats");
    expect(stats.textContent).toContain(i18n.t("incident.stat.open-for"));
    expect(stats.textContent).not.toContain(i18n.t("incident.stat.closed-in"));
    expect(stats.querySelector("[data-stat='notified']")?.textContent).toContain("1");
    expect(stats.textContent).toContain(i18n.t("incident.stat.notified-note", { count: 0 }));
  });

  it("switches to the closed figure once the incident is resolved", async () => {
    mountWith({ incident: { ...detail.incident, status: "resolved", resolvedAt: "2026-08-21T10:00:00Z" } });
    const stats = await screen.findByTestId("incident-stats");
    expect(stats.textContent).toContain(i18n.t("incident.stat.closed-in"));
    expect(stats.textContent).not.toContain(i18n.t("incident.stat.open-for"));
  });

  // Roadmap 1.1: only an incident whose page published a creation time, and that
  // arrived while somebody was watching, has a detection delay to show.
  it("says how long after the provider's announcement the incident was detected", async () => {
    mountWith({ incident: { ...detail.incident, declaredAt: "2026-08-21T09:00:00Z", firstSeenAt: "2026-08-21T09:04:00Z" } });
    const detected = (await screen.findByTestId("incident-stats")).querySelector('[data-stat="detected"]');
    expect(detected).toHaveTextContent(i18n.t("incident.stat.detected"));
    expect(detected).toHaveTextContent("4 min");
  });

  it("shows no detection delay for an incident that cannot be measured", async () => {
    mount();
    expect((await screen.findByTestId("incident-stats")).querySelector('[data-stat="detected"]')).toBeNull();
  });

  // Roadmap 6.3: an undeclared rate is not a free outage.
  it("shows no cost without a declared rate", async () => {
    mount();
    expect((await screen.findByTestId("incident-stats")).querySelector('[data-stat="cost"]')).toBeNull();
  });

  it("shows the cost, once, when the provider has a declared rate", async () => {
    mountWith({ incident: { ...detail.incident, cost: 1800 } });
    const cost = (await screen.findByTestId("incident-stats")).querySelector('[data-stat="cost"]');
    expect(cost).toHaveTextContent("1,800.00");
    expect(cost).toHaveTextContent(i18n.t("incident.stat.cost"));
  });
});

describe("the incident over time", () => {
  it("draws the incident as one image, with a legend that names only what is drawn", async () => {
    mount();
    const line = await screen.findByTestId("incident-lifeline");
    expect(within(line).getByRole("img")).toHaveAccessibleName(new RegExp(i18n.t("incident.life.label")));
    expect(within(line).getByText(i18n.t("incident.life.down"))).toBeInTheDocument();
    expect(within(line).queryByText(i18n.t("incident.life.failed"))).toBeNull();
  });

  it("names a failed alert in the legend once one is on the line", async () => {
    mountWith({ actionLog: [{ ...detail.actionLog[0], ok: false }] });
    const line = await screen.findByTestId("incident-lifeline");
    expect(within(line).getByText(i18n.t("incident.life.failed"))).toBeInTheDocument();
  });
});

describe("what happened", () => {
  it("labels every entry from the catalog, in the active language", async () => {
    await i18n.changeLanguage("it");
    try {
      mount();
      expect(await screen.findByText(i18n.getFixedT("it")("incident.event.opened"))).toBeInTheDocument();
      expect(screen.getByText(i18n.getFixedT("it")("incident.events.title"))).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("puts what was sent, our observations and the notes in one list, newest first", async () => {
    mount();
    const list = (await screen.findByText(i18n.t("incident.events.title"))).closest("section")!;
    const text = within(list).getAllByRole("listitem").map((item) => item.textContent ?? "");
    const at = (needle: string) => text.findIndex((entry) => entry.includes(needle));
    // 09:15 observed, 09:05 note, 09:01 sent, 09:00 opened.
    expect(at(i18n.t("incident.event.observed"))).toBeLessThan(at(i18n.t("incident.event.note")));
    expect(at(i18n.t("incident.event.note"))).toBeLessThan(at(i18n.t("incident.event.sends", { count: 1 })));
    expect(at(i18n.t("incident.event.sends", { count: 1 }))).toBeLessThan(at(i18n.t("incident.event.opened")));
  });

  it("folds sends into one row per burst and lists the channels behind a disclosure", async () => {
    mountWith({
      actionLog: [
        { ...detail.actionLog[0], channel: "telegram", sentAt: "2026-08-21T09:01:00Z" },
        { ...detail.actionLog[0], channel: "slack", sentAt: "2026-08-21T09:02:00Z", ok: false },
      ],
    });
    expect(await screen.findByText(i18n.t("incident.event.sends", { count: 2 }))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("incident.event.sends-detail", { delivered: 1, failed: 1 }))).toBeInTheDocument();
    expect(screen.getAllByText(i18n.t("incident.event.failed")).length).toBeGreaterThan(0);
    expect(screen.getByText(i18n.t("incident.event.channels"))).toBeInTheDocument();
    expect(screen.getByText("slack")).toBeInTheDocument();
  });

  it("leaves out the sends entry when nothing was sent, rather than drawing an empty one", async () => {
    mountWith({ actionLog: [] });
    await screen.findByRole("heading", { name: "API errors" });
    expect(screen.queryByText(i18n.t("incident.event.channels"))).toBeNull();
  });
});

describe("the context column", () => {
  it("leaves out the provider's other open incidents when there are none", async () => {
    mount();
    await screen.findByRole("heading", { name: "API errors" });
    expect(screen.queryByText(i18n.t("incident.other-active"))).toBeNull();
  });

  it("lists the provider's other open incidents, each a link to its own page", async () => {
    mountWith({
      otherActiveIncidents: [{ ...detail.incident, incidentId: "i2", name: "Slow pushes", status: "identified" }],
    });
    const link = await screen.findByRole("link", { name: /Slow pushes/ });
    expect(link).toHaveAttribute("href", "#/incidents/github/i2");
  });

  it("offers the provider's map behind a disclosure once the operator has turned the map on", async () => {
    mountWithMap();
    const trigger = await screen.findByRole("button", { name: i18n.t("incident.map.show") });
    expect(screen.queryByText(i18n.t("incident.map.title", { name: "GitHub" }))).toBeNull();
    await userEvent.click(trigger);
    expect(await screen.findByText(i18n.t("incident.map.title", { name: "GitHub" }))).toBeInTheDocument();
  });

  it("offers no map at all while the preference is off", async () => {
    mount();
    await screen.findByRole("heading", { name: "API errors" });
    expect(screen.queryByRole("button", { name: i18n.t("incident.map.show") })).toBeNull();
  });
});

// Roadmap 5.3. The third account of an incident, beside what IsItDown observed
// and what it sent: the one a person writes.
describe("operator notes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the notes already written on this incident", async () => {
    mount();

    expect(await screen.findByText("Our deploy failed on this.")).toBeInTheDocument();
  });

  it("posts a typed note to this incident and clears the draft", async () => {
    mount();
    const field = await screen.findByLabelText(i18n.t("incident.notes.add"));

    const base = globalThis.fetch as typeof fetch;
    const sent: { target: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string, init?: RequestInit) => {
        if (String(target).endsWith("/notes")) {
          sent.push({ target: String(target), body: String(init?.body) });
          return {
            ok: true,
            status: 201,
            text: async () => JSON.stringify({ id: 2, body: "Vendor confirmed", createdAt: "2026-08-21T10:00:00Z" }),
          };
        }
        return base(target, init);
      }),
    );

    await userEvent.type(field, "Vendor confirmed");
    await userEvent.click(screen.getByRole("button", { name: i18n.t("incident.notes.add") }));

    expect(sent).toHaveLength(1);
    // The harness mounts the route *pattern* as the location, so the ids in the
    // url are the pattern's own; what this pins is that the note is posted to
    // the incident the view was opened on, and nowhere else.
    expect(sent[0]?.target.endsWith("/notes")).toBe(true);
    expect(JSON.parse(sent[0]!.body)).toEqual({ body: "Vendor confirmed" });
    expect(field).toHaveValue("");
  });

  it("will not post a note that is only whitespace", async () => {
    mount();
    const field = await screen.findByLabelText(i18n.t("incident.notes.add"));

    await userEvent.type(field, "   ");

    expect(screen.getByRole("button", { name: i18n.t("incident.notes.add") })).toBeDisabled();
  });

  it("removes a note through the incident it was written on", async () => {
    mount();
    const remove = await screen.findByRole("button", { name: i18n.t("incident.notes.remove") });

    const base = globalThis.fetch as typeof fetch;
    const calls: { method: string; target: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string, init?: RequestInit) => {
        if (String(target).includes("/notes/")) {
          calls.push({ method: String(init?.method), target: String(target) });
          return { ok: true, status: 204, text: async (): Promise<string> => "" };
        }
        return base(target, init);
      }),
    );

    await userEvent.click(remove);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("DELETE");
    // The note's own id, under the incident it was written on.
    expect(calls[0]?.target.endsWith("/notes/1")).toBe(true);
  });
});

// Roadmap 1.11: what the provider changed about the incident after resolving it
// is one more entry on the timeline, absent for the nearly every incident nobody touched.
describe("edits made after resolution", () => {
  it("adds nothing to the timeline for an incident nobody touched again", async () => {
    mountWith({ revisions: [] });
    await screen.findByRole("heading", { name: "API errors" });
    expect(document.querySelector("[data-revision]")).toBeNull();
  });

  it("says which field moved, from what to what, in the catalog's words", async () => {
    mountWith({
      revisions: [
        { field: "impact", before: "major", after: "minor", observedAt: "2026-08-22T09:00:00Z" },
        { field: "resolved_at", before: "2026-08-21T12:00:00Z", after: "2026-08-21T10:00:00Z", observedAt: "2026-08-22T09:00:00Z" },
      ],
    });
    expect(
      await screen.findByText(i18n.t("incident.revisions.impact", { before: i18n.t("impact.major"), after: i18n.t("impact.minor") })),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-revision="resolved_at"]')).toHaveTextContent(/End moved/);
  });

  it("shows an impact word the catalog does not know as the provider wrote it", async () => {
    mountWith({ revisions: [{ field: "impact", before: "sev1", after: "sev3", observedAt: "2026-08-22T09:00:00Z" }] });
    expect(await screen.findByText(i18n.t("incident.revisions.impact", { before: "sev1", after: "sev3" }))).toBeInTheDocument();
  });
});

// Roadmap 3.6: following one incident from its own page.
describe("following an incident", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers to follow an open incident, and says what following does", async () => {
    mount();
    const button = await screen.findByRole("button", { name: i18n.t("incident.follow") });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(i18n.t("incident.follow.hint"))).toBeInTheDocument();
  });

  it("follows with a PUT and unfollows with a DELETE on the incident's own follow route", async () => {
    renderWithProviders(<IncidentDetail />, {
      incident: { ...detail, followed: true },
      status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
    }, "/incidents/:providerId/:incidentId");
    const button = await screen.findByRole("button", { name: i18n.t("incident.following") });
    expect(button).toHaveAttribute("aria-pressed", "true");

    const base = globalThis.fetch as typeof fetch;
    const calls: { method: string; target: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string, init?: RequestInit) => {
        if (String(target).endsWith("/follow")) {
          calls.push({ method: String(init?.method), target: String(target) });
          return { ok: true, status: 200, text: async () => JSON.stringify({ followed: false }) };
        }
        return base(target, init);
      }),
    );

    await userEvent.click(button);
    expect(calls).toEqual([{ method: "DELETE", target: expect.stringMatching(/\/follow$/) }]);
  });

  it("says so when following fails, rather than looking followed", async () => {
    mount();
    const button = await screen.findByRole("button", { name: i18n.t("incident.follow") });
    const base = globalThis.fetch as typeof fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string, init?: RequestInit) => {
        if (String(target).endsWith("/follow")) {
          return { ok: false, status: 409, text: async () => JSON.stringify({ error: { message: "already resolved" } }) };
        }
        return base(target, init);
      }),
    );
    await userEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("already resolved");
  });

  it("offers nothing to follow on a resolved incident", async () => {
    renderWithProviders(<IncidentDetail />, {
      incident: { ...detail, incident: { ...detail.incident, resolvedAt: "2026-08-21T11:00:00Z" } },
      status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
    }, "/incidents/:providerId/:incidentId");
    await screen.findByText("API errors");
    expect(screen.queryByRole("button", { name: i18n.t("incident.follow") })).toBeNull();
  });
});
