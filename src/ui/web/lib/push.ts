export interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  label: string;
}

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Firefox\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const PLATFORMS: [RegExp, string][] = [
  [/Windows/, "Windows"],
  [/Android/, "Android"],
  [/iPhone|iPad/, "iOS"],
  [/Mac OS X/, "macOS"],
  [/Linux/, "Linux"],
];

const match = (candidates: [RegExp, string][], value: string): string | undefined =>
  candidates.find(([pattern]) => pattern.test(value))?.[1];

/** What the device list shows, so the operator can tell two browsers apart. */
export function deviceLabel(userAgent: string): string {
  const browser = match(BROWSERS, userAgent);
  const platform = match(PLATFORMS, userAgent);
  if (browser === undefined && platform === undefined) return "Browser";
  return [browser, platform].filter((part) => part !== undefined).join(" · ");
}

/** False outside a secure context, where the browser hides the Push API entirely. */
export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// `new Uint8Array(length)` rather than `Uint8Array.from(...)`: since TS 5.7 the
// typed-array constructors are generic over their backing buffer, and only the
// `(length)` overload is typed `Uint8Array<ArrayBuffer>` — the shape
// `PushSubscriptionOptionsInit.applicationServerKey` (a `BufferSource`)
// actually requires. `from`'s inferred `Uint8Array<ArrayBufferLike>` (which
// also admits a `SharedArrayBuffer`-backed view) does not satisfy that.
const applicationServerKey = (base64: string): Uint8Array<ArrayBuffer> => {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
};

// `PushSubscription.toJSON()`'s real keys, and what the server's
// `web-push`/VAPID plumbing actually expects, are base64url — no `+`/`/`,
// no `=` padding. `btoa` only produces standard base64, so its output is
// converted the same way `applicationServerKey` above decodes it, just in
// reverse. The server currently tolerates standard base64 too (Buffer's
// `"base64url"` decoder is lenient about it), but emitting the real wire
// format keeps this independent of that leniency.
export const encode = (buffer: ArrayBuffer | null): string =>
  buffer === null
    ? ""
    : btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

/** Brave is the only engine that exposes `navigator.brave`. */
export function braveBrowser(): boolean {
  return "brave" in navigator;
}

/**
 * Chromium reports a refusal from its own push service as a DOMException the
 * operator cannot act on ("Registration failed - push service error"), so it
 * becomes a reason code the card can explain instead. Brave disables that
 * service by default and is worth its own wording; on any other Chromium a
 * firewall, VPN or DNS filter in front of the push endpoints is the usual
 * cause. Anything else passes through with its own message.
 */
export function subscribeFailureReason(error: unknown, brave: boolean): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!/push service/i.test(message)) return message;
  return brave ? "push-service-brave" : "push-service";
}

/**
 * A service worker holds at most one push subscription, bound for life to the
 * applicationServerKey it was created with: subscribing again under a different
 * key fails with "A subscription with a different applicationServerKey (or
 * gcm_sender_id) already exists". Every browser that subscribed while the VAPID
 * pair still came from the environment is in exactly that state now that the
 * server generates its own, and the browser's own advice — unsubscribe, then
 * resubscribe — is something this button can simply do.
 *
 * Only a subscription under a *different* key is dropped: unsubscribing the
 * current one would hand the server a new endpoint on every click and leave the
 * device list growing rows for one browser.
 */
async function dropStaleSubscription(registration: ServiceWorkerRegistration, publicKey: string): Promise<void> {
  const existing = await registration.pushManager.getSubscription();
  if (existing === null) return;
  if (encode(existing.options.applicationServerKey) === publicKey) return;
  await existing.unsubscribe();
}

/**
 * Registers the service worker, asks for permission, and returns the body the
 * API expects. Throws with a translatable reason so the card can explain itself.
 */
export async function subscribeThisBrowser(publicKey: string): Promise<PushSubscriptionBody> {
  const registration = await navigator.serviceWorker.register("/sw.js");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("denied");

  await dropStaleSubscription(registration, publicKey);

  let subscription: PushSubscription;
  try {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(publicKey),
    });
  } catch (error) {
    throw new Error(subscribeFailureReason(error, braveBrowser()));
  }

  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: encode(subscription.getKey("p256dh")),
      auth: encode(subscription.getKey("auth")),
    },
    label: deviceLabel(navigator.userAgent),
  };
}
