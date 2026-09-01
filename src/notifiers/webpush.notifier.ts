import webpush from "web-push";
import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { PushSubscription, PushSubscriptionStore } from "../core/pushSubscriptionStore.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { renderMessage } from "./formatting.ts";

const keysSchema = z.object({
  publicKey: z.string().min(1, "the webpush channel needs a VAPID public key"),
  privateKey: z.string().min(1, "the webpush channel needs a VAPID private key"),
});

/**
 * The toast's icon. A provider's own `/favicon.ico` is frequently absent on a
 * Statuspage-hosted page (the real icon hides behind a `<link rel="icon">` on a
 * CDN), and a service worker gets no `onerror` retry across candidates the way
 * the dashboard's ring does — one URL is all a notification gets. So it uses
 * the same icon service the ring falls back to, which always answers with an
 * image. Empty when the status URL does not parse: the toast then shows the
 * browser's own default rather than a broken square.
 *
 * Kept in step with src/ui/web/lib/favicon.ts, which resolves the same icon for
 * the dashboard.
 */
export function providerIcon(statusUrl: string): string {
  try {
    return `https://icons.duckduckgo.com/ip3/${new URL(statusUrl).host}.ico`;
  } catch {
    return "";
  }
}

/**
 * Required by the Web Push protocol as a contact for the push service. It is
 * not a deliverable address and never leaves the request.
 */
const VAPID_SUBJECT = "mailto:operator@isitdown.local";

/**
 * Matches telegram.notifier.ts and webhook.notifier.ts: Node's HTTPS client has
 * no default timeout, so a push service that accepts the connection and never
 * answers would otherwise leave `send()` pending forever — which stalls
 * `dispatch`'s `Promise.allSettled` and, with it, the scheduler's whole cycle
 * (its in-flight flag never clears, so polling stops for good even though the
 * container keeps reporting healthy).
 */
const PUSH_TIMEOUT_MS = 10_000;

export interface VapidDetails {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** Injected so the unit test never reaches a real push service. */
export type PushTransport = (
  subscription: PushSubscription,
  payload: string,
  vapid: VapidDetails,
) => Promise<void>;

const defaultTransport: PushTransport = async (subscription, payload, vapid) => {
  await webpush.sendNotification(subscription, payload, {
    vapidDetails: vapid,
    TTL: 600,
    timeout: PUSH_TIMEOUT_MS,
  });
};

/**
 * Bounds every transport call, not only the request `defaultTransport` itself
 * makes: the library's own `timeout` option guards the real HTTPS socket, but
 * the "cannot hang" guarantee has to hold for whatever implements
 * `PushTransport` — including a test double — or it only holds in production.
 */
function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`webpush: the push service did not respond within ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const statusOf = (error: unknown): number | undefined =>
  typeof error === "object" && error !== null && "statusCode" in error
    ? (error as { statusCode?: number }).statusCode
    : undefined;

/** A transport error with no HTTP status (DNS failure, TLS error, connection
 * refused, our own timeout above) never reached an HTTP response — reporting
 * "HTTP unknown" would imply one did. The underlying error's own message is
 * the real information in that case. */
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Browser push. Unlike every other channel this one fans out to a list that the
 * operator's browsers grow and the push service shrinks: a 404 or 410 means that
 * device is gone for good, so it is dropped rather than retried forever.
 */
export function createWebPushNotifier(deps: {
  /** Generated and stored by the edition, never asked of the operator. */
  keys: { publicKey: string; privateKey: string };
  store: PushSubscriptionStore;
  push?: PushTransport | undefined;
}): Notifier {
  const { publicKey, privateKey } = keysSchema.parse(deps.keys);
  const push = deps.push ?? defaultTransport;
  const vapid: VapidDetails = { subject: VAPID_SUBJECT, publicKey, privateKey };

  return {
    id: "webpush",

    async send(payload: NotificationPayload): Promise<void> {
      const subscriptions = await deps.store.list();
      if (subscriptions.length === 0) throw new Error("webpush: no device registered");

      // `renderMessage` always prefixes the shared message with one emoji, which
      // is exactly the headline a toast wants; splitting it here keeps the
      // channels from drifting apart in wording.
      const message = renderMessage(payload);
      const [emoji = "", ...rest] = message.split(" ");
      const icon = providerIcon(payload.service.statusUrl);
      const body = JSON.stringify({
        title: `${emoji} ${payload.service.name}`,
        body: rest.join(" "),
        url: "/",
        providerId: payload.change.providerId,
        // The provider being reported, not IsItDown: a toast stack shows which
        // service is down before a word of it is read.
        ...(icon === "" ? {} : { icon }),
      });

      let delivered = 0;
      let failure: string | undefined;

      for (const subscription of subscriptions) {
        try {
          await withTimeout(push(subscription, body, vapid), PUSH_TIMEOUT_MS);
          delivered += 1;
        } catch (error) {
          const status = statusOf(error);
          if (status === 404 || status === 410) {
            await deps.store.prune(subscription.endpoint);
            continue;
          }
          failure ??=
            status === undefined
              ? `webpush notification failed: ${messageOf(error)}`
              : `webpush notification failed: HTTP ${status}`;
        }
      }

      if (failure !== undefined) {
        // A fan-out is not all-or-nothing: discarding the delivered count here
        // would make "one broken browser" indistinguishable from "nothing sent".
        throw new Error(
          delivered > 0 ? `${failure} (${delivered} of ${subscriptions.length} devices delivered)` : failure,
        );
      }
      // Every device turned out to be dead: the operator has no working target
      // left, and the feed should say so rather than show a delivery.
      if (delivered === 0) throw new Error("webpush: no device registered");
    },
  };
}
