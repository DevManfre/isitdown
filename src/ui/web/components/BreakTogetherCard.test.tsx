import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import type { CoincidentPair, ServiceDefinition } from "@/lib/types.ts";
import { BreakTogetherCard } from "./BreakTogetherCard.tsx";

const pair = (over: Partial<CoincidentPair> = {}): CoincidentPair => ({
  providerId: "npm",
  otherId: "github",
  together: 7,
  incidents: 9,
  rate: 0.78,
  lift: 11.4,
  declared: false,
  ...over,
});

const service = (id: string, dependsOn?: string[]): ServiceDefinition => ({
  id,
  name: id,
  adapter: "statuspage",
  baseUrl: "https://x.example",
  enabled: true,
  components: [],
  scopeToComponents: false,
  ...(dependsOn === undefined ? {} : { dependsOn }),
});

const mount = (pairs: CoincidentPair[], services: ServiceDefinition[] = [service("npm")]) =>
  renderWithProviders(
    <BreakTogetherCard pairs={pairs} services={services} nameOf={(id) => id.toUpperCase()} />,
  );

describe("BreakTogetherCard", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("says how often the pair went down together, without claiming a cause", async () => {
    mount([pair()]);
    expect(
      await screen.findByText(i18n.t("coincidence.row", { a: "NPM", b: "GITHUB", together: 7, of: 9 })),
    ).toBeInTheDocument();
    expect(screen.getByText(i18n.t("coincidence.hint"))).toBeInTheDocument();
  });

  it("renders nothing when every pair is already declared", () => {
    const { container } = mount([pair({ declared: true })]);
    expect(container).toBeEmptyDOMElement();
  });

  it("dismissing a pair hides it and remembers that on this browser", async () => {
    mount([pair()]);
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("coincidence.dismiss") }));
    expect(screen.queryByRole("button", { name: i18n.t("coincidence.dismiss") })).toBeNull();
    expect(window.localStorage.getItem("isitdown.coincidence.dismissed")).toContain("npm|github");
  });

  it("declaring PATCHes the base provider, keeping what it already depended on", async () => {
    mount([pair()], [service("npm", ["aws"])]);
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("coincidence.declare") }));
    await waitFor(() => {
      const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit?][];
      const call = calls.find(([path, init]) => init?.method === "PATCH" && path === "/config/services/npm");
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ dependsOn: ["aws", "github"] });
    });
  });
});
