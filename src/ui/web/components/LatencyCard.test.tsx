import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import { LatencyCard } from "./LatencyCard.tsx";

afterEach(() => vi.unstubAllGlobals());

const providers = [
  { id: "github", name: "GitHub" },
  { id: "cloudflare", name: "Cloudflare" },
];

const latency = (over: object = {}) => ({
  provider: "github",
  range: "7d",
  slowMs: 800,
  summary: { p50: 182, p95: 640, samples: 120, overSlow: 3 },
  points: [
    { at: "2026-10-29T00:00:00.000Z", p50: 180, p95: 600, samples: 10 },
    { at: "2026-10-29T06:00:00.000Z", p50: 190, p95: 700, samples: 10 },
  ],
  ...over,
});

const region = () => screen.findByRole("region", { name: i18n.t("latency.title") });

describe("LatencyCard — roadmap 4.14", () => {
  it("states the conclusion as text, not only as a chart", async () => {
    renderWithProviders(<LatencyCard providers={providers} />, { latency: latency() });
    const card = within(await region());

    expect(await card.findByText("182 ms")).toBeInTheDocument();
    expect(card.getByText("640 ms")).toBeInTheDocument();
    expect(card.getByText(i18n.t("latency.stat.slow", { ms: "800" }))).toBeInTheDocument();
    expect(card.getByLabelText(i18n.t("latency.chart", { name: "GitHub", p50: "182", p95: "640" }))).toBeInTheDocument();
  });

  it("leaves the threshold out when the provider declares none", async () => {
    renderWithProviders(<LatencyCard providers={providers} />, {
      latency: latency({ slowMs: null, summary: { p50: 182, p95: 640, samples: 120, overSlow: null } }),
    });
    const card = within(await region());

    await card.findByText("182 ms");
    expect(card.queryByText(/Readings over/)).toBeNull();
  });

  it("says latency is not there yet rather than drawing an empty chart", async () => {
    renderWithProviders(<LatencyCard providers={providers} />, { latency: latency({ summary: null, points: [] }) });

    expect(await screen.findByText(i18n.t("latency.empty"))).toBeInTheDocument();
  });

  it("asks for the range the operator picks", async () => {
    renderWithProviders(<LatencyCard providers={providers} />, { latency: latency() });
    const card = within(await region());
    await card.findByText("182 ms");

    await userEvent.click(card.getByRole("radio", { name: i18n.t("latency.range.30d") }));

    const asked = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => String(call[0]));
    expect(asked.some((path) => path.includes("provider=github") && path.includes("range=30d"))).toBe(true);
  });

  it("renders nothing for a fleet with no provider", () => {
    const { container } = renderWithProviders(<LatencyCard providers={[]} />, {});
    expect(container).toBeEmptyDOMElement();
  });
});
