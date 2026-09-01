export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * The device list a browser-push channel delivers to. Declared here, beside
 * `StateStore`, for the same reason: the notifier must not know whether the
 * subscriptions come from SQLite, a file, or a test double.
 */
export interface PushSubscriptionStore {
  list(): Promise<PushSubscription[]>;
  /** Drops a device the push service reported as gone (404 or 410). */
  prune(endpoint: string): Promise<void>;
}
