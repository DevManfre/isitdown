import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The module parks a browser event caught at load time, so each test needs its
 * own copy of it rather than a shared one carrying the previous test's state.
 */
async function loadPwa() {
  vi.resetModules();
  return import("./pwa.ts");
}

/** The event Chrome fires, with the two promises the module awaits. */
function installPromptEvent(outcome: "accepted" | "dismissed") {
  const event = new Event("beforeinstallprompt") as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

describe("installability (roadmap 5.21)", () => {
  let matchMedia: typeof window.matchMedia;

  beforeEach(() => {
    matchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = matchMedia;
  });

  it("offers nothing until the browser says an install is possible", async () => {
    const pwa = await loadPwa();
    expect(pwa.canInstall()).toBe(false);
    expect(await pwa.promptInstall()).toBe(false);
  });

  it("takes the browser's event over, so the dashboard can show its own button", async () => {
    // Without preventDefault, Chrome shows its own mini-infobar and never hands
    // the event across — the button could then never appear at all.
    const pwa = await loadPwa();
    const event = installPromptEvent("accepted");
    const prevented = vi.spyOn(event, "preventDefault");

    window.dispatchEvent(event);

    expect(prevented).toHaveBeenCalled();
    expect(pwa.canInstall()).toBe(true);
  });

  it("tells a subscriber when the offer arrives", async () => {
    const pwa = await loadPwa();
    const listener = vi.fn();
    const unsubscribe = pwa.onInstallabilityChange(listener);

    window.dispatchEvent(installPromptEvent("accepted"));

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("reports whether the prompt was accepted", async () => {
    const pwa = await loadPwa();
    window.dispatchEvent(installPromptEvent("accepted"));
    expect(await pwa.promptInstall()).toBe(true);
  });

  it("reports a dismissal as one", async () => {
    const pwa = await loadPwa();
    window.dispatchEvent(installPromptEvent("dismissed"));
    expect(await pwa.promptInstall()).toBe(false);
  });

  it("spends the event, because a browser refuses to prompt on it twice", async () => {
    // Keeping it would leave a button that silently does nothing on the second
    // press, which is worse than no button.
    const pwa = await loadPwa();
    window.dispatchEvent(installPromptEvent("accepted"));
    await pwa.promptInstall();
    expect(pwa.canInstall()).toBe(false);
  });

  it("withdraws the offer once the app is installed", async () => {
    const pwa = await loadPwa();
    window.dispatchEvent(installPromptEvent("accepted"));
    window.dispatchEvent(new Event("appinstalled"));
    expect(pwa.canInstall()).toBe(false);
  });

  it("knows the installed window from a browser tab", async () => {
    const pwa = await loadPwa();
    expect(pwa.isStandalone()).toBe(false);
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    expect(pwa.isStandalone()).toBe(true);
  });
});

describe("service worker registration", () => {
  it("registers after load, and survives a browser that refuses", async () => {
    // Firefox in private browsing refuses. No offline shell is a far smaller
    // thing than a dashboard that will not start.
    const register = vi.fn().mockRejectedValue(new Error("not allowed"));
    vi.stubGlobal("navigator", { ...navigator, serviceWorker: { register } });
    const pwa = await loadPwa();

    pwa.registerServiceWorker();
    window.dispatchEvent(new Event("load"));
    await Promise.resolve();

    expect(register).toHaveBeenCalledWith("/sw.js");
    vi.unstubAllGlobals();
  });
});
