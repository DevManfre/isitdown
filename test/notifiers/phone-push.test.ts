import { test } from "node:test";
import assert from "node:assert/strict";
import { createTwilioSmsNotifier } from "../../src/notifiers/twilio-sms.notifier.ts";
import { createTwilioCallNotifier } from "../../src/notifiers/twilio-call.notifier.ts";
import { createBarkNotifier } from "../../src/notifiers/bark.notifier.ts";
import { createSignalNotifier } from "../../src/notifiers/signal.notifier.ts";
import { createBlueskyNotifier } from "../../src/notifiers/bluesky.notifier.ts";
import { ChannelError } from "../../src/notifiers/errors.ts";
import { jsonResponse, stubFetch, type CapturedRequest } from "../helpers/fetchStub.ts";
import { opened, payloadFor } from "./contract/fixtures.ts";
import type { NotificationPayload } from "../../src/core/types.ts";

/**
 * The phone, push and public-post channels of roadmap 3.9: what each does with
 * a language, a severity or a link that the contract suite cannot ask about.
 */

const twilio = { accountSid: "AC1", authToken: "tok", from: "+15005550006", to: "+393331234567" };

async function sent(send: () => Promise<unknown>, respond = (_: CapturedRequest) => jsonResponse({})): Promise<CapturedRequest[]> {
  const stub = stubFetch(respond);
  try {
    await send();
  } finally {
    stub.restore();
  }
  return stub.requests;
}

test("twilio: the account authenticates in a header, never in the URL", async () => {
  const [request] = await sent(() => createTwilioSmsNotifier(twilio).send(opened));
  assert.equal(request?.url, "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
  assert.equal(request?.headers.authorization, `Basic ${Buffer.from("AC1:tok").toString("base64")}`);
  assert.equal(new URLSearchParams(request?.rawBody).get("To"), "+393331234567");
});

test("twilio: a refusal reports Twilio's own sentence", async () => {
  await assert.rejects(
    sent(
      () => createTwilioSmsNotifier(twilio).send(opened),
      () => jsonResponse({ code: 21211, message: "The 'To' number is not a valid phone number." }, 400),
    ),
    (error: unknown) => error instanceof ChannelError && /twilio-sms .*HTTP 400 \(The 'To' number/.test(error.message),
  );
});

test("twilio: settings missing a number are refused by name", () => {
  assert.throws(() => createTwilioCallNotifier({ ...twilio, to: "" }), /to is required for the twilio-call channel/);
});

test("twilio-call: the message is read in the payload's language, without emoji", async () => {
  const italian: NotificationPayload = { ...opened, locale: "it" };
  const [request] = await sent(() => createTwilioCallNotifier(twilio).send(italian));
  const twiml = new URLSearchParams(request?.rawBody).get("Twiml") ?? "";
  assert.match(twiml, /<Say language="it-IT">/);
  assert.ok(!twiml.includes("🔴"));
});

test("twilio-call: a provider's own words are escaped inside the TwiML", async () => {
  const hostile = payloadFor("incident_opened", {
    incident: { id: "x", name: `<Hangup/> & "quotes"`, impact: "major", status: "investigating", updatedAt: opened.change.at },
  });
  const [request] = await sent(() => createTwilioCallNotifier(twilio).send(hostile));
  const twiml = new URLSearchParams(request?.rawBody).get("Twiml") ?? "";
  assert.ok(!twiml.includes("<Hangup/>"));
  assert.match(twiml, /&lt;Hangup\/&gt; &amp; &quot;quotes&quot;/);
});

test("twilio-call: an unknown locale falls back to an English voice", async () => {
  const [request] = await sent(() => createTwilioCallNotifier(twilio).send({ ...opened, locale: "xx" }));
  assert.match(new URLSearchParams(request?.rawBody).get("Twiml") ?? "", /<Say language="en-US">/);
});

test("bark: only a major outage rings through silent mode", async () => {
  const notifier = createBarkNotifier({ deviceKey: "d" });
  const levels: string[] = [];
  for (const payload of [opened, payloadFor("component_status_change"), payloadFor("status_change"), payloadFor("monitoring_degraded")]) {
    const [request] = await sent(() => notifier.send(payload));
    levels.push((request?.body as { level: string }).level);
  }
  assert.deepEqual(levels, ["critical", "timeSensitive", "active", "passive"]);
});

test("bark: a self-hosted server replaces the public one", async () => {
  const [request] = await sent(() => createBarkNotifier({ deviceKey: "d", serverUrl: "https://bark.lan/" }).send(opened));
  assert.equal(request?.url, "https://bark.lan/push");
});

test("bark: a malformed server URL is refused in the shared rule's words", () => {
  assert.throws(
    () => createBarkNotifier({ deviceKey: "d", serverUrl: "ftp://bark.lan" }),
    /serverUrl must be an http or https URL for the bark channel/,
  );
});

test("signal: recipients are a comma-separated list, blanks dropped", async () => {
  const [request] = await sent(() =>
    createSignalNotifier({ serverUrl: "http://signal:8080", number: "+39", recipients: " +391, group.abc ,," }).send(opened),
  );
  assert.equal(request?.url, "http://signal:8080/v2/send");
  assert.deepEqual((request?.body as { recipients: string[] }).recipients, ["+391", "group.abc"]);
});

test("signal: no recipient at all is refused by name", () => {
  assert.throws(
    () => createSignalNotifier({ serverUrl: "http://signal:8080", number: "+39", recipients: " , " }),
    /recipients is required for the signal channel/,
  );
});

const bluesky = (request: CapturedRequest): Response =>
  request.url.endsWith("createSession")
    ? jsonResponse({ did: "did:plc:me", accessJwt: "jwt" })
    : jsonResponse({ uri: "at://x", cid: "c" });

test("bluesky: the status page is a link facet over its exact bytes, after non-ASCII text", async () => {
  const payload = payloadFor("incident_opened", {
    incident: { id: "x", name: "Ritardi sui pagamenti — è grave 🔥", impact: "major", status: "investigating", updatedAt: opened.change.at },
  });
  const requests = await sent(() => createBlueskyNotifier({ handle: "me", appPassword: "pw" }).send(payload), bluesky);
  const record = (requests[1]?.body as { record: { text: string; facets: { index: { byteStart: number; byteEnd: number } }[] } }).record;
  const bytes = Buffer.from(record.text, "utf8");
  const facet = record.facets[0]?.index;
  assert.ok(facet !== undefined);
  assert.equal(bytes.subarray(facet.byteStart, facet.byteEnd).toString("utf8"), "https://www.githubstatus.com");
  assert.equal(requests[1]?.headers.authorization, "Bearer jwt");
});

test("bluesky: a self-hosted PDS replaces bsky.social", async () => {
  const requests = await sent(
    () => createBlueskyNotifier({ handle: "me", appPassword: "pw", serviceUrl: "https://pds.example" }).send(opened),
    bluesky,
  );
  assert.equal(requests[0]?.url, "https://pds.example/xrpc/com.atproto.server.createSession");
});

test("bluesky: a refused login says so, without the app password", async () => {
  await assert.rejects(
    sent(
      () => createBlueskyNotifier({ handle: "me", appPassword: "pw-secret" }).send(opened),
      () => jsonResponse({ error: "AuthenticationRequired", message: "Invalid identifier or password" }, 401),
    ),
    (error: unknown) =>
      error instanceof ChannelError &&
      error.message === "bluesky notification login failed: HTTP 401 (AuthenticationRequired: Invalid identifier or password)",
  );
});

test("bluesky: a malformed PDS URL is refused by name", () => {
  assert.throws(
    () => createBlueskyNotifier({ handle: "me", appPassword: "pw", serviceUrl: "pds.example" }),
    /serviceUrl must be an http or https URL for the bluesky channel/,
  );
});
