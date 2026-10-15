import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import { SharedFailureCard } from "./SharedFailureCard.tsx";

afterEach(() => vi.unstubAllGlobals());

describe("SharedFailureCard", () => {
  it("names the likely cause and lists every dependent that is down", async () => {
    renderWithProviders(
      <SharedFailureCard
        failure={{
          cause: "cloudflare",
          dependents: [
            { id: "npm", name: "npm", enabled: true, overallStatus: "major_outage" },
            { id: "vercel", name: "Vercel", enabled: true, overallStatus: "degraded" },
          ],
        }}
        nameOf={(id) => (id === "cloudflare" ? "Cloudflare" : id)}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: i18n.t("shared-failure.title", { cause: "Cloudflare" }) }),
    ).toBeInTheDocument();
    expect(screen.getByText(i18n.t("shared-failure.count", { count: 2 }))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "npm" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vercel" })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: i18n.t("shared-failure.graph", { cause: "Cloudflare" }) }),
    ).toBeInTheDocument();
  });
});
