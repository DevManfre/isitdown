import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider, useTranslation } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { createQueryClient } from "@/lib/queryClient.ts";
import { ThemeProvider, useTheme } from "./useTheme.tsx";
import { usePreferenceSync } from "./usePreferenceSync.tsx";

function Probe() {
  usePreferenceSync();
  const { mode } = useTheme();
  // Read through useTranslation, not off the singleton: the hook subscribes to
  // i18next's own change event, so a language the sync adopts actually shows up
  // in the DOM instead of being stuck at whatever the first render saw.
  const { i18n: live } = useTranslation();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="lang">{live.language}</span>
    </div>
  );
}

function mount(preferences: { theme: string; uiLocale: string; notificationLocale: string }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(preferences) })),
  );
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createQueryClient({ retry: false })}>
        <ThemeProvider>
          <Probe />
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const mode = () => screen.getByTestId("mode").textContent;
const attr = () => document.documentElement.getAttribute("data-theme");

afterEach(async () => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  await i18n.changeLanguage("en");
});

/**
 * The read half of the round-trip the design spec (§7.4) says the double
 * persistence exists for. `Header` wrote theme and locale to the database from
 * the start, but nothing read them back: `useTheme` initialised from
 * localStorage alone and `i18n.ts` set `lng` from localStorage alone, so a fresh
 * browser ignored the database entirely and `PATCH /api/preferences` was writing
 * to something no one read.
 */
describe("usePreferenceSync", () => {
  it("seeds the theme from the server on a browser with no stored choice", async () => {
    mount({ theme: "dark", uiLocale: "en", notificationLocale: "en" });

    expect(await vi.waitFor(() => { expect(mode()).toBe("dark"); return mode(); })).toBe("dark");
    expect(attr()).toBe("dark");
  });

  it("seeds the locale from the server on a browser with no stored choice", async () => {
    mount({ theme: "system", uiLocale: "it", notificationLocale: "en" });

    await vi.waitFor(() => expect(screen.getByTestId("lang").textContent).toBe("it"));
    expect(localStorage.getItem("isitdown.uiLocale")).toBe("it");
  });

  // The precedence that keeps the pre-paint script honest: index.html has
  // already stamped the local choice on <html> before React runs, so letting a
  // server value override it would repaint the page into a different theme a
  // beat after it appeared — the exact flash the pre-paint script exists to
  // prevent.
  it("leaves a locally stored theme alone, however the server disagrees", async () => {
    localStorage.setItem("isitdown.theme", "light");
    mount({ theme: "dark", uiLocale: "en", notificationLocale: "en" });

    expect(mode()).toBe("light");
    // Give the query, the effect and any adopt() a full chance to land.
    await vi.waitFor(() => expect(screen.getByTestId("mode")).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mode()).toBe("light");
    expect(attr()).toBe("light");
  });

  it("leaves a locally stored locale alone, however the server disagrees", async () => {
    localStorage.setItem("isitdown.uiLocale", "en");
    mount({ theme: "system", uiLocale: "it", notificationLocale: "en" });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("lang").textContent).toBe("en");
    expect(localStorage.getItem("isitdown.uiLocale")).toBe("en");
  });

  // Mounted in the app shell, above every view's error boundary — a server that
  // is not answering yet must cost the defaults, not the whole dashboard.
  // Vanilla said as much in `start()`: "defaults are fine if the server is not
  // answering yet".
  it("keeps the shell standing when /api/preferences fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, text: async () => "" })),
    );
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={createQueryClient({ retry: false })}>
          <ThemeProvider>
            <Probe />
          </ThemeProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mode()).toBe("system");
    expect(screen.getByTestId("lang")).toBeInTheDocument();
  });
});
