import { test } from "node:test";
import assert from "node:assert/strict";
import { createGotifyNotifier } from "../../src/notifiers/gotify.notifier.ts";
import { stubFetch } from "../helpers/fetchStub.ts";
import type { NotificationPayload } from "../../src/core/types.ts";

const settings = { serverUrl: "https://gotify.example.com", token: "AppTokenSecret" };

const opened: NotificationPayload = {
  change: {
    kind: "incident_opened",
    providerId: "github",
    currentStatus: "major_outage",
    incident: {
      id: "i1",
      name: "API requests failing",
      impact: "major",
      status: "investigating",
      updatedAt: "2026-08-19T14:32:07.000Z",
    },
    at: "2026-08-19T14:32:07.000Z",
  },
  service: { id: "github", name: "GitHub", statusUrl: "https://www.githubstatus.com" },
  locale: "en",
};

type GotifyBody = {
  title: string;
  message: string;
  priority: number;
  extras: { "client::notification": { click: { url: string } } };
};

const okResponse = (): Response => new Response("{}", { status: 200 });

test("an opened incident posts a titled message to the server's message endpoint", async () => {
  const stub = stubFetch(okResponse);
  try {
    await createGotifyNotifier(settings).send(opened);
  } finally {
    stub.restore();
  }

  const [request] = stub.requests;
  assert.equal(request?.url, "https://gotify.example.com/message");
  assert.equal(request?.method, "POST");
  const body = request?.body as GotifyBody;
  assert.equal(body.title, "🔴 GitHub — MAJOR OUTAGE");
  assert.ok(body.message.includes("API requests failing"), body.message);
  // The status page is the notification's tap target, not a line in the text.
  assert.ok(!body.message.includes("githubstatus.com"), body.message);
  assert.equal(body.extras["client::notification"].click.url, opened.service.statusUrl);
});

test("the application token travels as a header, never in the URL", async () => {
  const stub = stubFetch(okResponse);
  try {
    await createGotifyNotifier(settings).send(opened);
  } finally {
    stub.restore();
  }

  assert.equal(stub.requests[0]?.headers["x-gotify-key"], "AppTokenSecret");
  assert.ok(!stub.requests[0]?.url.includes("AppTokenSecret"), stub.requests[0]?.url);
});

test("severity decides the priority, so only the worst reading is allowed to ring", async () => {
  const stub = stubFetch(okResponse);
  try {
    const notifier = createGotifyNotifier(settings);
    await notifier.send(opened);
    await notifier.send({ ...opened, change: { ...opened.change, currentStatus: "degraded" } });
    await notifier.send({
      ...opened,
      change: { ...opened.change, kind: "incident_resolved", currentStatus: "operational" },
    });
  } finally {
    stub.restore();
  }

  assert.deepEqual(
    stub.requests.map((request) => (request.body as GotifyBody).priority),
    [9, 5, 3],
  );
});

test("a trailing slash on the server url does not double up in the path", async () => {
  const stub = stubFetch(okResponse);
  try {
    await createGotifyNotifier({ ...settings, serverUrl: "https://gotify.example.com/" }).send(opened);
  } finally {
    stub.restore();
  }
  assert.equal(stub.requests[0]?.url, "https://gotify.example.com/message");
});

test("a non-2xx response rejects with the status and Gotify's own reason, never the token", async () => {
  const stub = stubFetch(
    () => new Response(JSON.stringify({ errorDescription: "you need to provide a valid access token" }), { status: 401 }),
  );
  try {
    await createGotifyNotifier(settings).send(opened);
    assert.fail("expected the send to reject");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(message.includes("401"), message);
    assert.ok(message.includes("valid access token"), message);
    assert.ok(!message.includes("AppTokenSecret"), message);
  } finally {
    stub.restore();
  }
});

test("the notifier refuses a missing token or a non-http server url", () => {
  assert.throws(() => createGotifyNotifier({ serverUrl: settings.serverUrl, token: "" }), /token/);
  assert.throws(() => createGotifyNotifier({ serverUrl: "", token: "t" }), /serverUrl/);
  assert.throws(() => createGotifyNotifier({ serverUrl: "gotify://server", token: "t" }), /serverUrl/);
});

test("the notifier reports its channel id", () => {
  assert.equal(createGotifyNotifier(settings).id, "gotify");
});
