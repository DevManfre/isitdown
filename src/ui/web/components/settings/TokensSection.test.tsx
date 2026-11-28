import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import * as api from "@/lib/api.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import type { ApiToken, ApiTokenList } from "@/lib/types.ts";
import { TokensSection } from "./TokensSection.tsx";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const token = (over: Partial<ApiToken> = {}): ApiToken => ({
  id: 1,
  name: "GitHub Actions — deploys",
  scopes: ["read", "annotations:write"],
  createdAt: "2026-11-12T09:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  ...over,
});

/**
 * The empty state's button, asked for once the section has settled: the router
 * the harness mounts renders the view a second time on start, and a node found
 * during the first render is gone by the time it is clicked.
 */
async function openCreate(): Promise<void> {
  await screen.findByText(i18n.t("tokens.empty.title"));
  await waitFor(() => expect(screen.getByRole("button", { name: i18n.t("tokens.create") })).toBeInTheDocument());
  await new Promise((resolve) => setTimeout(resolve, 0));
  await userEvent.click(screen.getByRole("button", { name: i18n.t("tokens.create") }));
}

const list = (over: Partial<ApiTokenList> = {}): ApiTokenList => ({ tokens: [], envToken: false, ...over });

describe("Settings → API tokens (roadmap 9.11)", () => {
  it("shows a skeleton while loading, never the empty state", () => {
    vi.spyOn(api, "getApiTokens").mockReturnValue(new Promise(() => {}));
    renderWithProviders(<TokensSection />);
    expect(screen.queryByText(i18n.t("tokens.empty.title"))).toBeNull();
  });

  it("with no tokens, says so and offers to create one", async () => {
    renderWithProviders(<TokensSection />, { apiTokens: list() });
    expect(await screen.findByText(i18n.t("tokens.empty.title"))).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: i18n.t("tokens.create") })).toHaveLength(1);
  });

  it("a failed load says why and can be retried", async () => {
    renderWithProviders(<TokensSection />, { errors: { apiTokens: 500 } });
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("button", { name: i18n.t("action.retry") })).toBeInTheDocument();
  });

  it("lists tokens with their access as words, and API_TOKEN as a row it cannot revoke", async () => {
    renderWithProviders(<TokensSection />, { apiTokens: list({ tokens: [token()], envToken: true }) });
    const row = (await screen.findByText("GitHub Actions — deploys")).closest("tr") as HTMLElement;
    expect(within(row).getByText(i18n.t("tokens.scope.read"))).toBeInTheDocument();
    expect(within(row).getByText(i18n.t("tokens.scope.annotations"))).toBeInTheDocument();
    expect(within(row).getByText(i18n.t("tokens.never"))).toBeInTheDocument();

    const envRow = screen.getByText("API_TOKEN").closest("tr") as HTMLElement;
    expect(within(envRow).queryByRole("button")).toBeNull();
    expect(within(envRow).getByText(i18n.t("tokens.env.hint"))).toBeInTheDocument();
  });

  it("revoking asks first, naming the token, and only then calls the server", async () => {
    const revoke = vi.spyOn(api, "revokeApiToken").mockResolvedValue(undefined);
    renderWithProviders(<TokensSection />, { apiTokens: list({ tokens: [token({ id: 7 })] }) });
    await userEvent.click(
      await screen.findByRole("button", { name: i18n.t("tokens.revoke.label", { name: "GitHub Actions — deploys" }) }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(i18n.t("tokens.revoke.title", { name: "GitHub Actions — deploys" }))).toBeInTheDocument();
    expect(revoke).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("tokens.revoke.confirm") }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(7, expect.anything()));
  });

  it("creates a token and shows it once; closing the view forgets it", async () => {
    const create = vi.spyOn(api, "createApiToken").mockResolvedValue({
      ...token({ id: 2, name: "Mute script", scopes: ["mute"] }),
      token: "iid_secret-value",
    });
    renderWithProviders(<TokensSection />, { apiTokens: list({ tokens: [token()] }) });
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("tokens.create") }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("tokens.dialog.name")), "Mute script");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: new RegExp(i18n.t("tokens.scope.read")) }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: new RegExp(i18n.t("tokens.scope.mute")) }));
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("tokens.dialog.submit") }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: "Mute script", scopes: ["mute"] }, expect.anything()));
    expect(await screen.findByLabelText(i18n.t("tokens.shown.label"))).toHaveTextContent("iid_secret-value");

    await userEvent.click(screen.getByRole("button", { name: i18n.t("tokens.shown.done") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("iid_secret-value")).toBeNull();
  });

  it("Admin implies every other scope and is the only one sent", async () => {
    const create = vi.spyOn(api, "createApiToken").mockResolvedValue({ ...token({ scopes: ["admin"] }), token: "iid_x" });
    renderWithProviders(<TokensSection />, { apiTokens: list() });
    await openCreate();
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(i18n.t("tokens.dialog.name")), "ops");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: new RegExp(i18n.t("tokens.scope.admin")) }));

    const mute = within(dialog).getByRole("checkbox", { name: new RegExp(i18n.t("tokens.scope.mute")) });
    expect(mute).toBeChecked();
    expect(mute).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("tokens.dialog.submit") }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: "ops", scopes: ["admin"] }, expect.anything()));
  });

  it("a nameless token is refused in place, and Escape on a half-filled form asks first", async () => {
    const create = vi.spyOn(api, "createApiToken");
    renderWithProviders(<TokensSection />, { apiTokens: list() });
    await openCreate();
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: i18n.t("tokens.dialog.submit") }));
    expect(within(dialog).getByText(i18n.t("tokens.dialog.name-required"))).toBeInTheDocument();
    expect(within(dialog).getByLabelText(i18n.t("tokens.dialog.name"))).toHaveAttribute("aria-invalid", "true");
    expect(create).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByLabelText(i18n.t("tokens.dialog.name")), "half");
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByText(i18n.t("dialog.discard.title"))).toBeInTheDocument();
  });
});
