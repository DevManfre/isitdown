import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import { IncidentSummaryBlock } from "./IncidentSummaryBlock.tsx";

afterEach(() => vi.unstubAllGlobals());

const aiOn = {
  provider: "claude-cli",
  model: "",
  baseUrl: "",
  defaults: { anthropic: "claude-opus-5-5", openai: "", "claude-cli": "" },
  key: { envVar: "AI_API_KEY", set: false, saved: false },
  cliToken: { envVar: "CLAUDE_CODE_OAUTH_TOKEN", set: false, saved: false },
  claudeCli: true,
};

const mount = (fixtures: Parameters<typeof renderWithProviders>[1]) =>
  renderWithProviders(<IncidentSummaryBlock providerId="github" incidentId="inc-1" />, fixtures);

describe("the incident summary (roadmap 6.10)", () => {
  it("is absent while AI is off", async () => {
    mount({});
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByText(i18n.t("incident.summary.title"))).toBeNull();
  });

  it("offers a summary, writes it on request, and says who wrote it", async () => {
    mount({ ai: aiOn, summary: { summary: "API errors, fixed and resolved.", model: "Claude Code", updates: 3, generatedAt: "2026-11-12T10:00:00Z" } });
    const button = await screen.findByRole("button", { name: i18n.t("incident.summary.action") });
    expect(screen.getByText(i18n.t("incident.summary.hint"))).toBeInTheDocument();
    await userEvent.click(button);
    expect(await screen.findByText("API errors, fixed and resolved.")).toBeInTheDocument();
    const by = i18n.t("incident.summary.by", { model: "Claude Code", count: 3 });
    // Once on the page, once in the live region a screen reader hears.
    expect(screen.getAllByText(by)).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent(by);
    // The caveat stays beside the written summary.
    expect(screen.getByText(i18n.t("incident.summary.hint"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: i18n.t("incident.summary.again") })).toBeInTheDocument();
    const posted = (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit | undefined][]).find(([, init]) => init?.method === "POST");
    expect(posted?.[0]).toBe("/incidents/github/inc-1/summary");
    expect(JSON.parse(String(posted?.[1]?.body))).toEqual({ locale: i18n.language });
  });

  it("shows the server's reason when it fails, and offers to try again", async () => {
    mount({ ai: aiOn, errors: { summary: 502 } });
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("incident.summary.action") }));
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 502");
    expect(screen.getByRole("button", { name: i18n.t("action.retry") })).toBeInTheDocument();
  });
});
