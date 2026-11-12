import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import type { AiSettingsResponse } from "@/lib/types.ts";
import { AiSection } from "./AiSection.tsx";

afterEach(() => vi.unstubAllGlobals());

const settings = (over: Partial<AiSettingsResponse> = {}): AiSettingsResponse => ({
  provider: "off",
  model: "",
  baseUrl: "",
  defaults: { anthropic: "claude-opus-5-5", openai: "", "claude-cli": "" },
  key: { envVar: "AI_API_KEY", set: false, saved: false },
  cliToken: { envVar: "CLAUDE_CODE_OAUTH_TOKEN", set: false, saved: false },
  claudeCli: false,
  ...over,
});

/** Every write the section made, as method, path and body. */
const writes = (): string[] =>
  (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit | undefined][])
    .filter(([, init]) => init?.method !== undefined && init.method !== "GET")
    .map(([path, init]) => `${init?.method} ${path} ${typeof init?.body === "string" ? init.body : ""}`.trim());

describe("Settings → AI implementation (roadmap 6.10)", () => {
  it("off shows only the provider row and the note about subscriptions", async () => {
    renderWithProviders(<AiSection />, { ai: settings() });
    expect(await screen.findByLabelText(i18n.t("ai.provider.label"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("ai.subscriptions.note"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("ai.model.label"))).toBeNull();
    expect(screen.queryByText(i18n.t("ai.key.label"))).toBeNull();
  });

  it("anthropic asks for a key and offers its models in a menu, default first", async () => {
    renderWithProviders(<AiSection />, {
      ai: settings({ provider: "anthropic" }),
      aiModels: { models: [{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }, { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" }] },
    });
    const menu = await screen.findByRole("combobox", { name: i18n.t("ai.model.label") });
    expect(menu).toHaveTextContent(i18n.t("ai.model.default", { model: "claude-opus-5-5" }));
    await userEvent.click(menu);
    await userEvent.click(await screen.findByRole("option", { name: "Claude Haiku 5.5" }));
    await waitFor(() => expect(writes()).toContain('PATCH /config/ai {"model":"claude-haiku-5-5"}'));

    expect(screen.queryByText(i18n.t("ai.base-url.label"))).toBeNull();
    await userEvent.type(screen.getByLabelText(i18n.t("ai.key.label")), "sk-test");
    await userEvent.click(screen.getByRole("button", { name: i18n.t("action.save") }));
    await waitFor(() => expect(writes()).toContain('PUT /config/ai/key {"value":"sk-test"}'));
    expect(screen.getByLabelText(i18n.t("ai.key.label"))).toHaveValue("");
  });

  it("a saved model the list no longer offers stays chosen, and a list failure says why", async () => {
    renderWithProviders(<AiSection />, {
      ai: settings({ provider: "openai", model: "old-model" }),
      aiModels: { models: [], error: "http://ollama:11434/v1/models answered HTTP 502" },
    });
    expect(await screen.findByRole("combobox", { name: i18n.t("ai.model.label") })).toHaveTextContent("old-model");
    expect(screen.getByRole("alert")).toHaveTextContent("HTTP 502");
    expect(screen.getByRole("button", { name: i18n.t("action.retry") })).toBeInTheDocument();
  });

  it("openai-compatible shows the base url and commits text fields on blur", async () => {
    renderWithProviders(<AiSection />, { ai: settings({ provider: "openai" }) });
    const url = await screen.findByLabelText(i18n.t("ai.base-url.label"));
    expect(screen.getByText(i18n.t("ai.model.hint-required"))).toBeInTheDocument();
    expect(await screen.findByText(i18n.t("ai.model.none"))).toBeInTheDocument();
    await userEvent.type(url, "http://ollama:11434/v1");
    expect(writes()).toEqual([]);
    await userEvent.click(document.body);
    await waitFor(() => expect(writes()).toContain('PATCH /config/ai {"baseUrl":"http://ollama:11434/v1"}'));
  });

  it("local CLI says plainly when claude is not on the server, and takes a setup-token", async () => {
    renderWithProviders(<AiSection />, { ai: settings({ provider: "claude-cli", claudeCli: false }) });
    expect(await screen.findByText(i18n.t("ai.cli.missing"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("ai.key.label"))).toBeNull();
    await userEvent.type(screen.getByLabelText(i18n.t("ai.cli-token.label")), "sk-ant-oat-x");
    await userEvent.click(screen.getByRole("button", { name: i18n.t("action.save") }));
    await waitFor(() => expect(writes()).toContain('PUT /config/ai/cli-token {"value":"sk-ant-oat-x"}'));
  });

  it("a key the container supplied is reported but offers no clear", async () => {
    renderWithProviders(<AiSection />, {
      ai: settings({ provider: "anthropic", key: { envVar: "AI_API_KEY", set: true, saved: false } }),
    });
    expect(await screen.findByText(i18n.t("ai.key.from-env"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: i18n.t("action.clear") })).toBeNull();
  });

  it("a server that cannot answer says so instead of an empty card", async () => {
    renderWithProviders(<AiSection />, { errors: { ai: 500 } });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
