import { test } from "node:test";
import assert from "node:assert/strict";
import { createMattermostNotifier } from "../../src/notifiers/mattermost.notifier.ts";
import { createRocketchatNotifier } from "../../src/notifiers/rocketchat.notifier.ts";
import { createZulipNotifier } from "../../src/notifiers/zulip.notifier.ts";
import { createMastodonNotifier } from "../../src/notifiers/mastodon.notifier.ts";
import { createGoogleChatNotifier } from "../../src/notifiers/google-chat.notifier.ts";
import { ChannelError } from "../../src/notifiers/errors.ts";
import { jsonResponse, stubFetch } from "../helpers/fetchStub.ts";
import { opened, resolved } from "./contract/fixtures.ts";

/**
 * The chat channels of roadmap 3.9 that can rewrite what they posted — so an
 * incident's updates edit one message (roadmap 3.19) — and Google Chat, which
 * cannot, and threads instead. The contract suite covers the first send; this
 * covers the second one.
 */

test("mattermost: send returns the post id, and an update patches that post", async () => {
  const notifier = createMattermostNotifier({ serverUrl: "https://chat.example.com/", token: "t", channelId: "c" });
  const stub = stubFetch((request) =>
    request.method === "POST" ? jsonResponse({ id: "post1" }, 201) : jsonResponse({ id: "post1" }),
  );
  try {
    const ref = await notifier.send(opened);
    assert.equal(ref, "post1");
    await notifier.update?.(resolved, "post1");
  } finally {
    stub.restore();
  }
  const edit = stub.requests[1];
  assert.equal(edit?.method, "PUT");
  assert.equal(edit?.url, "https://chat.example.com/api/v4/posts/post1/patch");
  assert.match((edit?.body as { message: string }).message, /RESOLVED/);
});

test("mattermost: a refused edit is a ChannelError the dispatcher answers with a new post", async () => {
  const notifier = createMattermostNotifier({ serverUrl: "https://chat.example.com", token: "t", channelId: "c" });
  const stub = stubFetch(() => jsonResponse({ message: "Unable to find the existing post" }, 404));
  try {
    await assert.rejects(notifier.update?.(resolved, "gone") ?? Promise.resolve(), (error: unknown) => {
      assert.ok(error instanceof ChannelError);
      assert.match(error.message, /mattermost notification edit failed: HTTP 404 \(Unable to find/);
      return true;
    });
  } finally {
    stub.restore();
  }
});

test("rocketchat: an update names the room and the message it rewrites", async () => {
  const notifier = createRocketchatNotifier({ serverUrl: "https://chat.example.com", userId: "u", token: "t", roomId: "r" });
  const stub = stubFetch(() => jsonResponse({ success: true, message: { _id: "m1" } }));
  try {
    assert.equal(await notifier.send(opened), "m1");
    await notifier.update?.(resolved, "m1");
  } finally {
    stub.restore();
  }
  assert.equal(stub.requests[0]?.headers["x-user-id"], "u");
  assert.equal(stub.requests[1]?.url, "https://chat.example.com/api/v1/chat.update");
  assert.deepEqual(
    { roomId: (stub.requests[1]?.body as { roomId: string }).roomId, msgId: (stub.requests[1]?.body as { msgId: string }).msgId },
    { roomId: "r", msgId: "m1" },
  );
});

test("rocketchat: a 200 that says success: false is still a failure", async () => {
  const notifier = createRocketchatNotifier({ serverUrl: "https://chat.example.com", userId: "u", token: "t", roomId: "r" });
  const stub = stubFetch(() => jsonResponse({ success: false, error: "error-not-allowed" }));
  try {
    await assert.rejects(notifier.send(opened), /rocketchat notification rejected: error-not-allowed/);
  } finally {
    stub.restore();
  }
});

test("zulip: each provider gets its own topic unless one is set", async () => {
  const settings = { siteUrl: "https://z.example.com", botEmail: "b@z", apiKey: "k", stream: "status" };
  const stub = stubFetch(() => jsonResponse({ result: "success", id: 9 }));
  try {
    assert.equal(await createZulipNotifier(settings).send(opened), "9");
    await createZulipNotifier({ ...settings, topic: "outages" }).send(opened);
  } finally {
    stub.restore();
  }
  assert.equal(new URLSearchParams(stub.requests[0]?.rawBody).get("topic"), "GitHub");
  assert.equal(new URLSearchParams(stub.requests[1]?.rawBody).get("topic"), "outages");
  assert.equal(stub.requests[0]?.headers.authorization, `Basic ${Buffer.from("b@z:k").toString("base64")}`);
});

test("zulip: an update patches the message's content", async () => {
  const notifier = createZulipNotifier({ siteUrl: "https://z.example.com", botEmail: "b@z", apiKey: "k", stream: "s" });
  const stub = stubFetch(() => jsonResponse({ result: "success" }));
  try {
    await notifier.update?.(resolved, "9");
  } finally {
    stub.restore();
  }
  assert.equal(stub.requests[0]?.method, "PATCH");
  assert.equal(stub.requests[0]?.url, "https://z.example.com/api/v1/messages/9");
  assert.match(new URLSearchParams(stub.requests[0]?.rawBody).get("content") ?? "", /RESOLVED/);
});

test("mastodon: posts publicly by default, with the visibility the operator chose otherwise", async () => {
  const stub = stubFetch(() => jsonResponse({ id: "s1" }));
  try {
    assert.equal(await createMastodonNotifier({ instanceUrl: "https://m.example", accessToken: "t" }).send(opened), "s1");
    await createMastodonNotifier({ instanceUrl: "https://m.example", accessToken: "t", visibility: "unlisted" }).send(opened);
  } finally {
    stub.restore();
  }
  assert.equal((stub.requests[0]?.body as { visibility: string }).visibility, "public");
  assert.equal((stub.requests[1]?.body as { visibility: string }).visibility, "unlisted");
  assert.notEqual(stub.requests[0]?.headers["idempotency-key"], stub.requests[1]?.headers["idempotency-key"]);
});

test("mastodon: an unknown visibility is refused by name", () => {
  assert.throws(
    () => createMastodonNotifier({ instanceUrl: "https://m.example", accessToken: "t", visibility: "everyone" }),
    /visibility must be one of public, unlisted, private/,
  );
});

test("mastodon: an update edits the status, and the operator's notes never go public", async () => {
  const notifier = createMastodonNotifier({ instanceUrl: "https://m.example", accessToken: "t" });
  const stub = stubFetch(() => jsonResponse({ id: "s1" }));
  try {
    await notifier.update?.(
      { ...resolved, service: { ...resolved.service, owner: "Maria, +39 333" } },
      "s1",
    );
  } finally {
    stub.restore();
  }
  assert.equal(stub.requests[0]?.method, "PUT");
  assert.equal(stub.requests[0]?.url, "https://m.example/api/v1/statuses/s1");
  assert.ok(!(stub.requests[0]?.body as { status: string }).status.includes("Maria"));
});

test("google-chat: an incident's messages share a thread; a digest starts none", async () => {
  const notifier = createGoogleChatNotifier({ webhookUrl: "https://chat.googleapis.com/v1/spaces/A/messages?key=k" });
  const stub = stubFetch(() => jsonResponse({}));
  try {
    await notifier.send(opened);
    await notifier.send({ ...opened, digest: { items: [opened], windowMinutes: 15 } });
  } finally {
    stub.restore();
  }
  assert.match(stub.requests[0]?.url ?? "", /\?key=k&messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD$/);
  assert.deepEqual((stub.requests[0]?.body as { thread: unknown }).thread, {
    threadKey: "isitdown/github/incident/inc-1",
  });
  assert.equal((stub.requests[1]?.body as { thread?: unknown }).thread, undefined);
});

test("google-chat: a webhook URL without a query string gets one", async () => {
  const stub = stubFetch(() => jsonResponse({}));
  try {
    await createGoogleChatNotifier({ webhookUrl: "https://chat.example/hook" }).send(opened);
  } finally {
    stub.restore();
  }
  assert.equal(stub.requests[0]?.url, "https://chat.example/hook?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
});
