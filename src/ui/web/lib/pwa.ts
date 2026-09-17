/**
 * Installing the dashboard as an app — roadmap 5.21.
 *
 * Two jobs, both of which have to happen before React renders anything:
 *
 * 1. **Register the worker.** It was registered only when somebody turned web
 *    push on, which meant the offline shell existed for exactly the operators
 *    who had enabled a different feature. It is the same `/sw.js` either way,
 *    and registering twice is a no-op, so push keeps its own call.
 * 2. **Catch `beforeinstallprompt`.** Chrome fires it once, early, and a page
 *    that has not called `preventDefault` by then loses the chance to show its
 *    own install affordance for that visit. So the listener is attached at
 *    module load, and the event is parked here for whichever component asks
 *    later.
 */

/** The event Chrome fires. Not in lib.dom, because it is not standardised. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let parked: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

const announce = (): void => {
  for (const listener of listeners) listener();
};

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Without this the browser shows its own mini-infobar and never hands the
    // event over, so the dashboard's own button could never appear.
    event.preventDefault();
    parked = event as BeforeInstallPromptEvent;
    announce();
  });

  window.addEventListener("appinstalled", () => {
    // Nothing left to offer: the button that offered it must go away, or it
    // sits there promising something that has already happened.
    parked = null;
    announce();
  });
}

/** Whether the browser has offered an install for this visit. */
export const canInstall = (): boolean => parked !== null;

/**
 * Whether this is already the installed app rather than a browser tab. Used to
 * keep the install row off screen where it would mean nothing — an installed
 * window never fires `beforeinstallprompt`, but iOS never fires it either, and
 * the two need telling apart.
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own, on iOS, which implements none of the rest of this.
    ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true)
  );
}

/** Subscribes to changes in whether an install can be offered. Returns the unsubscribe. */
export function onInstallabilityChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Shows the browser's install dialog. Returns whether it was accepted.
 *
 * The parked event is spent either way: Chrome refuses a second `prompt()` on
 * the same event, so keeping it would leave a button that silently does
 * nothing on the second press.
 */
export async function promptInstall(): Promise<boolean> {
  const event = parked;
  if (event === null) return false;
  parked = null;
  announce();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}

/**
 * Registers the service worker. Safe to call on every load and alongside the
 * push subscription's own registration — the browser resolves the second call
 * to the registration the first one made.
 *
 * Failure is swallowed on purpose: no service worker means no offline shell,
 * which is a smaller thing than a dashboard that refuses to start because a
 * browser declined to register one (Firefox in private browsing, for instance).
 */
export function registerServiceWorker(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
