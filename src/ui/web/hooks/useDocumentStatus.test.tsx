import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders } from "@/test/harness.tsx";
import { STATUS_FALLBACK_FILL } from "@/lib/documentStatus.ts";
import type { OverallStatus } from "@/lib/types.ts";
import { useDocumentStatus } from "./useDocumentStatus.tsx";

/** The button re-reads `/status`, which is how a test moves the fleet on. */
function Probe() {
  useDocumentStatus();
  const client = useQueryClient();
  return (
    <button type="button" onClick={() => void client.invalidateQueries({ queryKey: ["status"] })}>
      re-read
    </button>
  );
}

const provider = (id: string, overallStatus: OverallStatus, enabled = true) => ({
  ...providerFixture(),
  id,
  overallStatus,
  enabled,
});

const ORIGINAL_TITLE = "IsItDown";
const ORIGINAL_ICON = "./favicon.svg";

/** The page's own icon link, the way index.html ships it. */
function withIconLink(): HTMLLinkElement {
  const link = document.createElement("link");
  link.setAttribute("rel", "icon");
  link.setAttribute("href", ORIGINAL_ICON);
  document.head.append(link);
  return link;
}

const mount = (providers: ReturnType<typeof provider>[]) =>
  renderWithProviders(<Probe />, {
    status: { providers, pollIntervalMinutes: 3, lastPollAt: null, nextPollAt: null },
  });

afterEach(() => {
  document.querySelectorAll('link[rel="icon"]').forEach((link) => link.remove());
  document.title = ORIGINAL_TITLE;
  vi.unstubAllGlobals();
});

describe("useDocumentStatus", () => {
  it("leaves the tab alone while the fleet is operational", async () => {
    const link = withIconLink();
    document.title = ORIGINAL_TITLE;

    mount([provider("github", "operational")]);

    // Waited on rather than asserted immediately: the effect has to have run
    // for "unchanged" to mean anything.
    await waitFor(() => expect(document.title).toBe(ORIGINAL_TITLE));
    expect(link.getAttribute("href")).toBe(ORIGINAL_ICON);
  });

  it("counts the providers in trouble in the title and puts a dot in the tab", async () => {
    const link = withIconLink();

    mount([
      provider("github", "major_outage"),
      provider("cloudflare", "degraded"),
      provider("anthropic", "operational"),
    ]);

    await waitFor(() =>
      expect(document.title).toBe(i18n.t("document.title.affected", { count: 2 })),
    );
    // The worst of the two decides the colour: a major outage beside a
    // degradation is not a degradation.
    const svg = decodeURIComponent(link.getAttribute("href") ?? "");
    expect(svg).toMatch(/^data:image\/svg\+xml,/);
    expect(svg).toContain(`fill="${STATUS_FALLBACK_FILL.major_outage}"`);
  });

  it("puts the page's own icon and title back when the fleet recovers", async () => {
    const link = withIconLink();
    document.title = ORIGINAL_TITLE;
    // One provider that is down on the first read and recovered on the next,
    // so the restore is exercised by the same mounted hook that drew the dot.
    let reads = 0;
    renderWithProviders(<Probe />, {
      status: () => {
        reads += 1;
        return {
          providers: [provider("github", reads === 1 ? "major_outage" : "operational")],
          pollIntervalMinutes: 3,
          lastPollAt: null,
          nextPollAt: null,
        };
      },
    });

    await waitFor(() => expect(link.getAttribute("href")).toMatch(/^data:/));

    await userEvent.click(await screen.findByRole("button", { name: "re-read" }));

    // The calm state is a restore, not a green dot: a dot in the tab always
    // means something to look at.
    await waitFor(() => expect(link.getAttribute("href")).toBe(ORIGINAL_ICON));
    expect(document.title).toBe(ORIGINAL_TITLE);
  });

  it("says nothing at all when the status read failed", async () => {
    // This hook lives above every view's error boundary, so it must degrade
    // like the rest of the chrome: the tab keeps the last honest thing it said.
    const link = withIconLink();
    document.title = ORIGINAL_TITLE;

    renderWithProviders(<Probe />, { errors: { status: 500 } });

    await waitFor(() => expect(link.getAttribute("href")).toBe(ORIGINAL_ICON));
    expect(document.title).toBe(ORIGINAL_TITLE);
  });

  it("ignores a disabled provider's outage: it is off the dashboard", async () => {
    withIconLink();
    document.title = ORIGINAL_TITLE;

    mount([provider("github", "major_outage", false), provider("cloudflare", "operational")]);

    await waitFor(() => expect(document.title).toBe(ORIGINAL_TITLE));
  });
});
