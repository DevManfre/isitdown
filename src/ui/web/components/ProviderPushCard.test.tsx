import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import type { ProviderPush, ProviderPushConfig } from "@/lib/types.ts";
import { ProviderPushCard } from "./ProviderPushCard.tsx";

const URL = "https://isitdown.example.com/push/github?token=k3v9abcdefq2";

const row = (over: Partial<ProviderPush> = {}): ProviderPush => ({
  providerId: "github",
  eligible: true,
  url: URL,
  lastReceivedAt: null,
  received: 0,
  ...over,
});

const config = (over: Partial<ProviderPushConfig> = {}): ProviderPushConfig => ({
  enabled: true,
  tokenRevealed: true,
  providers: [row()],
  ...over,
});

const mount = (providerPush: ProviderPushConfig) =>
  renderWithProviders(
    <ProviderPushCard providerId="github" providerName="GitHub" pageUrl="https://www.githubstatus.com" pollMinutes={3} />,
    { providerPush },
  );

afterEach(() => vi.unstubAllGlobals());

describe("ProviderPushCard", () => {
  it("says how to turn push on when PUSH_TOKEN is unset, with no address to copy", async () => {
    mount(config({ enabled: false, providers: [row({ url: null })] }));
    const card = await screen.findByTestId("provider-push");
    expect(card).toHaveAttribute("data-state", "off");
    expect(card).toHaveTextContent("PUSH_TOKEN");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders nothing for a provider the guide does not cover", async () => {
    const { container } = mount(config({ providers: [row({ eligible: false, url: null })] }));
    // Give the query a chance to land before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector('[data-testid="provider-push"]')).toBeNull();
  });

  it("while waiting, shows the address with its token masked and the step-by-step guide", async () => {
    mount(config());
    const card = await screen.findByTestId("provider-push");
    expect(card).toHaveAttribute("data-state", "waiting");
    const input = screen.getByLabelText(i18n.t("push.url"));
    expect(input).toHaveValue("https://isitdown.example.com/push/github?token=k3v9••••••••q2");
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("copies the full address, token included, not the masked one", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount(config());
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("push.copy") }));
    expect(writeText).toHaveBeenCalledWith(URL);
    expect(await screen.findByRole("button", { name: i18n.t("push.copied") })).toBeInTheDocument();
  });

  it("tells a read-only token holder the token is withheld rather than calling it a secret", async () => {
    mount(config({ tokenRevealed: false, providers: [row({ url: "https://x.example/push/github?token=<PUSH_TOKEN>" })] }));
    await screen.findByTestId("provider-push");
    expect(screen.getByText(i18n.t("push.token-hidden"))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t("push.url"))).toHaveValue("https://x.example/push/github?token=<PUSH_TOKEN>");
  });

  it("once a real post arrived, says it works and folds the guide away", async () => {
    mount(config({ providers: [row({ received: 12, lastReceivedAt: "2026-10-06T12:24:00Z" })] }));
    const card = await screen.findByTestId("provider-push");
    expect(card).toHaveAttribute("data-state", "working");
    expect(card).toHaveTextContent(i18n.t("push.received-count", { count: 12 }));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: i18n.t("push.guide.toggle") }));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
});
