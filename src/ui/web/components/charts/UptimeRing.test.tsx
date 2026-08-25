import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n.ts";
import { UptimeRing } from "./UptimeRing.tsx";
import type { ProviderStatus } from "@/lib/types.ts";

const provider = (over: Partial<ProviderStatus> = {}): ProviderStatus => ({
  id: "github", name: "GitHub", adapter: "statuspage", baseUrl: "https://www.githubstatus.com",
  enabled: true, overallStatus: "operational", activeIncidents: [], components: [],
  componentSelection: [], scopeToComponents: false, fetchedAt: null, failureCount: 0,
  uptime90: 99.9, ...over,
});

const mount = (p: ProviderStatus) =>
  render(<I18nextProvider i18n={i18n}><UptimeRing provider={p} /></I18nextProvider>);

describe("UptimeRing", () => {
  it("shows the three-letter abbreviation until an icon loads", () => {
    mount(provider());
    expect(screen.getByText("GIT")).toBeInTheDocument();
  });

  it("offers the provider's own favicon as the first candidate", () => {
    mount(provider());
    expect(screen.getByRole("presentation")).toHaveAttribute(
      "src", "https://www.githubstatus.com/favicon.ico",
    );
  });

  it("renders no icon at all for an unparseable base url", () => {
    mount(provider({ baseUrl: "not a url" }));
    expect(screen.queryByRole("presentation")).toBeNull();
  });

  it("labels the tile with the provider name", () => {
    mount(provider());
    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });
});
