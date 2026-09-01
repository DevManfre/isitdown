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

/**
 * Registers the service worker, asks for permission, and returns the body the
 * API expects. Throws with a translatable reason so the card can explain itself.
 */
export async function subscribeThisBrowser(publicKey: string): Promise<PushSubscriptionBody> {
  const registration = await navigator.serviceWorker.register("/sw.js");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("denied");

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(publicKey),
  });

  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: encode(subscription.getKey("p256dh")),
      auth: encode(subscription.getKey("auth")),
    },
    label: deviceLabel(navigator.userAgent),
  };
}
