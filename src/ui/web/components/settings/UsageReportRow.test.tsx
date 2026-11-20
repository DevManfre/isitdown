import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UsageReportRow } from "./UsageReportRow.tsx";
import i18n from "@/lib/i18n.ts";
import * as api from "@/lib/api.ts";
import * as pwa from "@/lib/pwa.ts";
import { noteDeprecatedUse } from "@/lib/deprecatedUse.ts";
import type { UsageReport } from "@/lib/types.ts";

const report: UsageReport = {
  edition: "ui",
  version: "2.46.0",
  providers: { total: 2, enabled: 2, byAdapter: { statuspage: 2 } },
  channels: ["webpush"],
  delivery: [],
  routingRules: 0,
  recipients: 0,
  features: { apiToken: false },
  deprecatedInUse: ["/export/trust.csv"],
};

describe("the usage report row (roadmap 16.3)", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.spyOn(pwa, "isStandalone").mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks the server nothing until the operator copies", () => {
    const get = vi.spyOn(api, "getUsageReport").mockResolvedValue(report);
    render(<UsageReportRow />);
    expect(get).not.toHaveBeenCalled();
    // No issue link before there is a report to put in it.
    expect(screen.queryByRole("link", { name: new RegExp(i18n.t("settings.usage.issue")) })).not.toBeInTheDocument();
    // The live region is there from the start, empty, so its change is heard.
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("copies the server's report with this browser's deprecated use added, and offers the issue", async () => {
    vi.spyOn(api, "getUsageReport").mockResolvedValue(report);
    noteDeprecatedUse("wallboard");
    render(<UsageReportRow />);

    await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.usage.copy") }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(i18n.t("settings.usage.copied")));
    const copied = String(writeText.mock.calls[0]?.[0]);
    const json = JSON.parse(copied.replace(/^```json\n|\n```$/g, "")) as UsageReport;
    expect(json.deprecatedInUse).toEqual(["/export/trust.csv", "wallboard"]);

    const link = screen.getByRole("link", { name: `${i18n.t("settings.usage.issue")} ${i18n.t("settings.usage.newTab")}` });
    const url = new URL(link.getAttribute("href") ?? "");
    expect(url.origin + url.pathname).toBe("https://github.com/devmanfre/isitdown/issues/new");
    expect(url.searchParams.get("body")).toBe(copied);
  });

  it("says so when the report cannot be read", async () => {
    vi.spyOn(api, "getUsageReport").mockRejectedValue(new Error("offline"));
    render(<UsageReportRow />);
    await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.usage.copy") }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(i18n.t("settings.usage.failed")));
    expect(screen.queryByRole("link", { name: new RegExp(i18n.t("settings.usage.issue")) })).not.toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });
});
