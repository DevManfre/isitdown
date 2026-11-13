import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import { OperatorSeriesRows } from "./OperatorSeriesRows.tsx";

afterEach(() => vi.unstubAllGlobals());

const writes = (): string[] =>
  (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit | undefined][])
    .filter(([, init]) => init?.method !== undefined && init.method !== "GET")
    .map(([path, init]) => `${init?.method} ${path} ${typeof init?.body === "string" ? init.body : ""}`.trim());

describe("Settings → Data → Your metrics (roadmap 6.11)", () => {
  it("says there are none yet, and adds a Prometheus series", async () => {
    renderWithProviders(<OperatorSeriesRows />, {});
    expect(await screen.findByText(i18n.t("series.settings.none"))).toBeInTheDocument();
    const add = screen.getByRole("button", { name: i18n.t("series.add.action") });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText(i18n.t("series.add.name")), "API 5xx");
    await userEvent.type(screen.getByLabelText(i18n.t("series.add.unit")), "%");
    await userEvent.type(screen.getByLabelText(i18n.t("series.add.url")), "http://prometheus:9090");
    await userEvent.type(screen.getByLabelText(i18n.t("series.add.query")), "sum(up)");
    await userEvent.click(add);
    await waitFor(() =>
      expect(writes()).toContain(
        'POST /config/series {"source":"prometheus","name":"API 5xx","unit":"%","url":"http://prometheus:9090","query":"sum(up)"}',
      ),
    );
  });

  it("lists declared series with how many points a CSV one holds", async () => {
    renderWithProviders(<OperatorSeriesRows />, {
      operatorSeries: {
        series: [{ id: 3, name: "Checkout errors", unit: "", source: "csv", url: null, query: null, points: 120, createdAt: "2026-11-01T00:00:00Z" }],
      },
    });
    expect(await screen.findByText("Checkout errors")).toBeInTheDocument();
    expect(screen.getByText(i18n.t("series.points", { count: 120 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: i18n.t("series.remove", { name: "Checkout errors" }) })).toBeInTheDocument();
  });
});
