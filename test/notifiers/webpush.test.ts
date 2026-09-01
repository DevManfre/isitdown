import { test } from "node:test";
import assert from "node:assert/strict";
import { createWebPushNotifier } from "../../src/notifiers/webpush.notifier.ts";
import type { PushSubscription, PushSubscriptionStore } from "../../src/core/pushSubscriptionStore.interface.ts";
import type { NotificationPayload } from "../../src/core/types.ts";

const keys = { publicKey: "BPub", privateKey: "kPriv" };

const device = (n: number): PushSubscription => ({
  endpoint: `https://push.example/${n}`,
  keys: { p256dh: `p${n}`, auth: `a${n}` },
});

function fakeStore(subscriptions: PushSubscription[]): PushSubscriptionStore & { pruned: string[] } {
  const pruned: string[] = [];
  return {
    pruned,
    list: async () => subscriptions,
    prune: async (endpoint: string) => {
      pruned.push(endpoint);
    },
  };
}

const degraded: NotificationPayload = {
  change: {
    kind: "status_change",
    providerId: "github",
    previousStatus: "operational",
    currentStatus: "degraded",
    at: "2026-08-19T14:32:07.000Z",
  },
  service: { id: "github", name: "GitHub", statusUrl: "https://www.githubstatus.com" },
  locale: "en",
};

test("every registered device receives the rendered change, split into a title and a body", async () => {
  const sent: { endpoint: string; payload: string }[] = [];
  const store = fakeStore([device(1), device(2)]);
  const notifier = createWebPushNotifier({
    keys,
    store,
    push: async (subscription, payload) => {
      sent.push({ endpoint: subscription.endpoint, payload });
    },
  });

  await notifier.send(degraded);

  assert.equal(notifier.id, "webpush");
  assert.deepEqual(
    sent.map((entry) => entry.endpoint),
    ["https://push.example/1", "https://push.example/2"],
  );
  const body = JSON.parse(sent[0]!.payload) as Record<string, string>;
  // The emoji heads the title so the toast is scannable; the rest of the shared
  // message is the body, unchanged from what every other channel sends.
  assert.match(body["title"]!, /^🟡 GitHub$/u);
  assert.match(body["body"]!, /GitHub/u);
  assert.doesNotMatch(body["body"]!, /^🟡/u);
  // The toast wears the provider's own icon, not IsItDown's.
  assert.equal(body["icon"], "https://icons.duckduckgo.com/ip3/www.githubstatus.com.ico");
  assert.equal(body["providerId"], "github");
  assert.equal(body["url"], "/");
});

test("a device the push service reports as gone is pruned, and the rest still count as delivered", async () => {
  const store = fakeStore([device(1), device(2)]);
  const notifier = createWebPushNotifier({
    keys,
    store,
    push: async (subscription) => {
      if (subscription.endpoint.endsWith("/1")) {
        throw Object.assign(new Error("Gone"), { statusCode: 410 });
      }
    },
  });

  await notifier.send(degraded);

  assert.deepEqual(store.pruned, ["https://push.example/1"]);
});

test("any other push failure is reported so the dispatcher records it", async () => {
  const store = fakeStore([device(1)]);
  const notifier = createWebPushNotifier({
    keys,
    store,
    push: async () => {
      throw Object.assign(new Error("Service Unavailable"), { statusCode: 503 });
    },
  });

  await assert.rejects(() => notifier.send(degraded), /webpush notification failed: HTTP 503/u);
  assert.deepEqual(store.pruned, []);
});

// Review finding 2: a transport error with no statusCode (DNS failure, TLS
// error, connection refused) used to be reported as "HTTP unknown", throwing
// away the real error and implying an HTTP response had arrived at all.
test("a transport failure with no HTTP status reports the underlying error instead of 'HTTP unknown'", async () => {
  const store = fakeStore([device(1)]);
  const notifier = createWebPushNotifier({
    keys,
    store,
    push: async () => {
      throw new Error("ECONNREFUSED: connection refused");
    },
  });

  await assert.rejects(
    () => notifier.send(degraded),
    /webpush notification failed: ECONNREFUSED: connection refused/u,
  );
  await assert.rejects(() => notifier.send(degraded), (error: Error) => {
    assert.doesNotMatch(error.message, /HTTP unknown/u);
    return true;
  });
});

// Review finding 4: two devices delivered plus one 500 used to throw only
// "webpush notification failed: HTTP 500", discarding the delivered count —
// the notification feed could not tell "one browser is broken" from "nothing
// was sent". The count is already tracked locally; the message now carries it.
test("a partial fan-out reports how many devices still got the message, not only the failure", async () => {
  const store = fakeStore([device(1), device(2), device(3)]);
  const notifier = createWebPushNotifier({
    keys,
    store,
    push: async (subscription) => {
      if (subscription.endpoint.endsWith("/3")) {
        throw Object.assign(new Error("Internal Server Error"), { statusCode: 500 });
      }
    },
  });

  await assert.rejects(
    () => notifier.send(degraded),
    /webpush notification failed: HTTP 500 \(2 of 3 devices delivered\)/u,
  );
});

// Review finding 1: `defaultTransport` calling `webpush.sendNotification` with
// no timeout meant a push service that accepted the connection and never
// answered left `send()` pending forever — which stalls `dispatch`'s
// `Promise.allSettled` and, with it, the scheduler's whole cycle. Every test
// above injects a transport that settles quickly, so none of them would have
// caught a hang; this one injects a transport that never settles at all and
// proves `send()` still does, using the test runner's fake timers rather than
// a real 10-second wait.
test("a transport that never resolves cannot hang send() past its own timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = fakeStore([device(1)]);
  const notifier = createWebPushNotifier({
    keys,
    store,
    push: () => new Promise<void>(() => {}),
  });

  const result = assert.rejects(() => notifier.send(degraded), /did not respond within 10000ms/u);
  // Let the pending `store.list()` microtask resolve and the loop reach
  // `withTimeout`'s own `setTimeout` call before advancing the mocked clock
  // past it — ticking too early would advance a timer that does not exist yet.
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(10_000);
  await result;
});

// The payload's `kind` field was never read by anything (sw.js does not look
// at it) — dropped so the wire shape only carries what a toast actually uses.
test("the payload sent to the push service carries no unused kind field", async () => {
  const sent: string[] = [];
  const notifier = createWebPushNotifier({
    keys,
    store: fakeStore([device(1)]),
    push: async (_subscription, payload) => {
      sent.push(payload);
    },
  });

  await notifier.send(degraded);

  const body = JSON.parse(sent[0]!) as Record<string, unknown>;
  assert.ok(!Object.hasOwn(body, "kind"));
});

test("with no device registered the send fails loudly rather than reporting a silent success", async () => {
  const notifier = createWebPushNotifier({ keys, store: fakeStore([]), push: async () => {} });
  await assert.rejects(() => notifier.send(degraded), /webpush: no device registered/u);
});

test("every device being pruned in one send is still a failure", async () => {
  const store = fakeStore([device(1)]);
  const notifier = createWebPushNotifier({
    keys,
    store,
    push: async () => {
      throw Object.assign(new Error("Gone"), { statusCode: 410 });
    },
  });

  await assert.rejects(() => notifier.send(degraded), /webpush: no device registered/u);
  assert.deepEqual(store.pruned, ["https://push.example/1"]);
});

test("an empty VAPID pair is refused when the channel is built", () => {
  assert.throws(() => createWebPushNotifier({ keys: { publicKey: "", privateKey: "" }, store: fakeStore([]), push: async () => {} }));
});

test("a status URL that does not parse leaves the toast without an icon", async () => {
  const sent: string[] = [];
  const notifier = createWebPushNotifier({
    keys,
    store: fakeStore([device(1)]),
    push: async (_subscription, payload) => {
      sent.push(payload);
    },
  });

  await notifier.send({ ...degraded, service: { ...degraded.service, statusUrl: "not a url" } });

  // Omitted rather than empty: an empty `icon` is a broken image, no `icon` is
  // the browser's own default.
  assert.ok(!Object.hasOwn(JSON.parse(sent[0]!) as Record<string, unknown>, "icon"));
});
