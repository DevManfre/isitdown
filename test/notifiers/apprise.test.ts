import { test } from "node:test";
import assert from "node:assert/strict";
import { createAppriseNotifier } from "../../src/notifiers/apprise.notifier.ts";
import { jsonResponse, stubFetch } from "../helpers/fetchStub.ts";
import type { NotificationPayload } from "../../src/core/types.ts";

const keyed = { serverUrl: "http://apprise:8000", configKey: "isitdown" };
const stateless = { serverUrl: "http://apprise:8000", urls: "mailto://ops@example.org,tgram://x/y" };

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

type AppriseBody = { title: string; body: string; type: string; urls?: string };

const ok = (): Response => jsonResponse({});

test("a stored configuration is notified by key, and the URLs never leave the server", async () => {
  const stub = stubFetch(ok);
  try {
    await createAppriseNotifier(keyed).send(opened);
  } finally {
    stub.restore();
  }

  const [request] = stub.requests;
  assert.equal(request?.url, "http://apprise:8000/notify/isitdown");
  const body = request?.body as AppriseBody;
  assert.equal(body.title, "🔴 GitHub — MAJOR OUTAGE");
  assert.equal(body.type, "failure");
  assert.equal(body.urls, undefined);
  // Apprise flattens away each service's link affordance, so the status page
  // has to be a line in the text to survive the bridge.
  assert.ok(body.body.includes("https://www.githubstatus.com"), body.body);
});

test("a stateless server is handed the service URLs with the notification", async () => {
  const stub = stubFetch(ok);
  try {
    await createAppriseNotifier(stateless).send(opened);
  } finally {
    stub.restore();
  }
  assert.equal(stub.requests[0]?.url, "http://apprise:8000/notify");
  assert.equal((stub.requests[0]?.body as AppriseBody).urls, stateless.urls);
});

test("with both set the stored configuration wins — it is the one an operator edits", async () => {
  const stub = stubFetch(ok);
  try {
    await createAppriseNotifier({ ...keyed, urls: stateless.urls }).send(opened);
  } finally {
    stub.restore();
  }
  assert.equal(stub.requests[0]?.url, "http://apprise:8000/notify/isitdown");
  assert.equal((stub.requests[0]?.body as AppriseBody).urls, undefined);
});

test("severity survives the bridge as Apprise's own type", async () => {
  const stub = stubFetch(ok);
  try {
    const notifier = createAppriseNotifier(keyed);
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
    stub.requests.map((request) => (request.body as AppriseBody).type),
    ["failure", "warning", "success"],
  );
});

test("a trailing slash on the server url does not double up in the path", async () => {
  const stub = stubFetch(ok);
  try {
    await createAppriseNotifier({ ...keyed, serverUrl: "http://apprise:8000/" }).send(opened);
  } finally {
    stub.restore();
  }
  assert.equal(stub.requests[0]?.url, "http://apprise:8000/notify/isitdown");
});

test("a rejected send reports the server's own reason", async () => {
  const stub = stubFetch(() => jsonResponse({ error: "No Apprise URLs provided" }, 400));
  try {
    await createAppriseNotifier(keyed).send(opened);
    assert.fail("expected the send to reject");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(message.includes("400"), message);
    assert.ok(message.includes("No Apprise URLs provided"), message);
  } finally {
    stub.restore();
  }
});

test("the notifier refuses a server with neither a key nor any URLs", () => {
  assert.throws(() => createAppriseNotifier({ serverUrl: "http://apprise:8000" }), /configKey or urls/);
  assert.throws(() => createAppriseNotifier({ serverUrl: "", configKey: "k" }), /serverUrl/);
});

test("the notifier reports its channel id", () => {
  assert.equal(createAppriseNotifier(keyed).id, "apprise");
});
