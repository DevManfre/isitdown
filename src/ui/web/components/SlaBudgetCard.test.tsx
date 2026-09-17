import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n.ts";
import { SlaBudgetCard } from "./SlaBudgetCard.tsx";
import type { SlaBudget } from "@/lib/types.ts";

const sla = vi.fn();

vi.mock("@/hooks/queries.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/queries.ts")>()),
  useSla: () => sla(),
}));

const budget = (over: Partial<SlaBudget> = {}): SlaBudget => ({
  providerId: "github",
  month: "2026-08",
  target: 99.9,
  uptime: 99.99,
  budgetMinutes: 44.6,
  spentMinutes: 4,
  remainingMinutes: 40.6,
  burnRate: 0.3,
  projectedUptime: 99.99,
  willMiss: false,
  elapsedMinutes: 13_680,
  monthMinutes: 44_640,
  measuredMinutes: 13_000,
  ...over,
});

const show = (providerId = "github") =>
  render(
    <I18nextProvider i18n={i18n}>
      <SlaBudgetCard providerId={providerId} />
    </I18nextProvider>,
  );

describe("the error budget card", () => {
  it("renders nothing at all for a provider nobody promised anything about", () => {
    // Absent from the answer, not present at 100%: an empty card claiming a
    // target that does not exist is worse than no card.
    sla.mockReturnValue({ data: { month: "2026-08", providers: [] } });
    const { container } = show();
    expect(container).toBeEmptyDOMElement();
  });

  it("says what the month has spent, and that it is on course", () => {
    sla.mockReturnValue({ data: { month: "2026-08", providers: [budget()] } });
    show();
    expect(screen.getByText(i18n.t("sla.spent", { spent: 4, allowed: 45 }))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(i18n.t("sla.on-track", { projected: "99.99%" })))).toBeInTheDocument();
  });

  it("says so when the rate means the month misses", () => {
    sla.mockReturnValue({
      data: { month: "2026-08", providers: [budget({ uptime: 90, projectedUptime: 90, willMiss: true, spentMinutes: 100, remainingMinutes: 0, burnRate: 7.3 })] },
    });
    show();
    expect(screen.getByText(new RegExp(i18n.t("sla.will-miss", { projected: "90.00%" })))).toBeInTheDocument();
  });

  it("does not report an unmeasured month as a perfect one, or as a failed one", () => {
    sla.mockReturnValue({
      data: {
        month: "2026-08",
        providers: [budget({ uptime: null, projectedUptime: null, burnRate: null, spentMinutes: 0 })],
      },
    });
    show();
    expect(screen.getByText(i18n.t("sla.unmeasured"))).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeNull(); // the target is still shown
  });

  it("survives the query failing, because a budget is not worth a page", () => {
    sla.mockReturnValue({ data: undefined });
    const { container } = show();
    expect(container).toBeEmptyDOMElement();
  });
});
