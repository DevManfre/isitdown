import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatrixNotifier } from "../../src/notifiers/matrix.notifier.ts";
import { jsonResponse, stubFetch } from "../helpers/fetchStub.ts";
import type { NotificationPayload } from "../../src/core/types.ts";

const settings = {
  homeserverUrl: "https://matrix.example.org",
  roomId: "!ops:example.org",
  accessToken: "syt_SuperSecret",
};

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

type MatrixBody = {
  msgtype: string;
  format: string;
  body: string;
  formatted_body: string;
  "m.new_content"?: { body: string; formatted_body: string };
  "m.relates_to"?: { rel_type: string; event_id: string };
};

const ok = (): Response => jsonResponse({ event_id: "$evt1" });

test("an opened incident is PUT into the room as a message in both formats", async () => {
  const stub = stubFetch(ok);
  try {
    await createMatrixNotifier(settings).send(opened);
  } finally {
    stub.restore();
  }

  const [request] = stub.requests;
  assert.equal(request?.method, "PUT");
  assert.ok(
    request?.url.startsWith(
      "https://matrix.example.org/_matrix/client/v3/rooms/!ops%3Aexample.org/send/m.room.message/",
    ),
    request?.url,
  );
  const body = request?.body as MatrixBody;
  assert.equal(body.msgtype, "m.text");
  assert.equal(body.format, "org.matrix.custom.html");
  assert.ok(body.body.includes("🔴 GitHub — MAJOR OUTAGE"), body.body);
  assert.ok(body.body.includes("API requests failing"), body.body);
  // A Matrix message has no separate link affordance, so the status page is a
  // line in the text and a link in the HTML.
  assert.ok(body.body.includes("https://www.githubstatus.com"), body.body);
  assert.ok(
    body.formatted_body.includes('<a href="https://www.githubstatus.com">'),
    body.formatted_body,
  );
});

test("the send returns the event id, so the message can be edited later", async () => {
  const stub = stubFetch(ok);
  try {
    assert.equal(await createMatrixNotifier(settings).send(opened), "$evt1");
  } finally {
    stub.restore();
  }
});

test("a homeserver that answers without an event id is a delivered message, not a failure", async () => {
  const stub = stubFetch(() => jsonResponse({}));
  try {
    assert.equal(await createMatrixNotifier(settings).send(opened), undefined);
  } finally {
    stub.restore();
  }
});

test("each send mints its own transaction id, so two alerts are never de-duplicated into one", async () => {
  const stub = stubFetch(ok);
  try {
    const notifier = createMatrixNotifier(settings);
    await notifier.send(opened);
    await notifier.send(opened);
  } finally {
    stub.restore();
  }
  assert.notEqual(stub.requests[0]?.url, stub.requests[1]?.url);
});

test("an update replaces the original event and carries a marked fallback", async () => {
  const stub = stubFetch(ok);
  try {
    await createMatrixNotifier(settings).update?.(
      { ...opened, change: { ...opened.change, kind: "incident_updated" } },
      "$evt1",
    );
  } finally {
    stub.restore();
  }

  const body = stub.requests[0]?.body as MatrixBody;
  assert.deepEqual(body["m.relates_to"], { rel_type: "m.replace", event_id: "$evt1" });
  assert.ok(body.body.startsWith("* "), body.body);
  assert.ok(body["m.new_content"]?.body.startsWith("🔴 GitHub"), body["m.new_content"]?.body);
});

test("an incident title is escaped rather than rendered as markup", async () => {
  const stub = stubFetch(ok);
  try {
    await createMatrixNotifier(settings).send({
      ...opened,
      change: {
        ...opened.change,
        incident: { ...opened.change.incident!, name: "<img src=x onerror=alert(1)>" },
      },
    });
  } finally {
    stub.restore();
  }

  const body = stub.requests[0]?.body as MatrixBody;
  assert.ok(!body.formatted_body.includes("<img"), body.formatted_body);
  assert.ok(body.formatted_body.includes("&lt;img"), body.formatted_body);
});

test("the access token travels as a header, never in the URL", async () => {
  const stub = stubFetch(ok);
  try {
    await createMatrixNotifier(settings).send(opened);
  } finally {
    stub.restore();
  }
  assert.equal(stub.requests[0]?.headers["authorization"], "Bearer syt_SuperSecret");
  assert.ok(!stub.requests[0]?.url.includes("syt_SuperSecret"), stub.requests[0]?.url);
});

test("a rejected send reports the homeserver's own errcode, never the token", async () => {
  const stub = stubFetch(
    () => jsonResponse({ errcode: "M_FORBIDDEN", error: "You are not in the room" }, 403),
  );
  try {
    await createMatrixNotifier(settings).send(opened);
    assert.fail("expected the send to reject");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(message.includes("403"), message);
    assert.ok(message.includes("M_FORBIDDEN"), message);
    assert.ok(!message.includes("syt_SuperSecret"), message);
  } finally {
    stub.restore();
  }
});

test("the notifier refuses a room alias, a missing token or a non-http homeserver", () => {
  assert.throws(() => createMatrixNotifier({ ...settings, roomId: "#ops:example.org" }), /roomId/);
  assert.throws(() => createMatrixNotifier({ ...settings, accessToken: "" }), /accessToken/);
  assert.throws(() => createMatrixNotifier({ ...settings, homeserverUrl: "matrix://x" }), /homeserverUrl/);
});

test("the notifier reports its channel id", () => {
  assert.equal(createMatrixNotifier(settings).id, "matrix");
});
