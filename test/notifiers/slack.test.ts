import { test } from "node:test";
import assert from "node:assert/strict";
import { createSlackNotifier } from "../../src/notifiers/slack.notifier.ts";
import { stubFetch } from "../helpers/fetchStub.ts";
import type { NotificationPayload } from "../../src/core/types.ts";

const settings = { webhookUrl: "https://hooks.slack.com/services/T0/B0/secret" };

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

type SlackBody = {
  text: string;
  blocks: {
    type: string;
    text?: { type: string; text: string };
    elements?: { type: string; text: { type: string; text: string }; url: string }[];
  }[];
};

const okResponse = (): Response => new Response("ok", { status: 200 });

test("an opened incident posts a section block and a link button", async () => {
  const stub = stubFetch(okResponse);
  try {
    await createSlackNotifier(settings).send(opened);
  } finally {
    stub.restore();
  }
  const [request] = stub.requests;
  assert.equal(request?.url, settings.webhookUrl);
  assert.equal(request?.method, "POST");
  assert.equal(request?.headers["content-type"], "application/json");

  const body = request?.body as SlackBody;
  const [section, actions] = body.blocks;
  assert.equal(section?.type, "section");
  assert.equal(section?.text?.type, "mrkdwn");
  assert.ok(section?.text?.text.includes("*🔴 GitHub — MAJOR OUTAGE*"), section?.text?.text);
  assert.ok(section?.text?.text.includes("API requests failing"), section?.text?.text);
  // The link is the button, so the bare URL is not repeated in the text.
  assert.ok(!section?.text?.text.includes("githubstatus.com"), section?.text?.text);

  assert.equal(actions?.type, "actions");
  const [button] = actions?.elements ?? [];
  assert.equal(button?.type, "button");
  assert.equal(button?.url, opened.service.statusUrl);
  assert.equal(button?.text.text, "Open status page");
});

test("the notification fallback text is the heading, so a push preview reads", async () => {
  const stub = stubFetch(okResponse);
  try {
    await createSlackNotifier(settings).send(opened);
  } finally {
    stub.restore();
  }
  assert.equal((stub.requests[0]?.body as SlackBody).text, "🔴 GitHub — MAJOR OUTAGE");
});

test("the button label follows the notification locale", async () => {
  const stub = stubFetch(okResponse);
  try {
    await createSlackNotifier(settings).send({ ...opened, locale: "it" });
  } finally {
    stub.restore();
  }
  const [, actions] = (stub.requests[0]?.body as SlackBody).blocks;
  assert.equal(actions?.elements?.[0]?.text.text, "Apri la pagina di stato");
});

test("a resolved transition is headed by the word resolved", async () => {
  const stub = stubFetch(okResponse);
  try {
    await createSlackNotifier(settings).send({
      ...opened,
      change: { ...opened.change, kind: "incident_resolved", currentStatus: "operational" },
    });
  } finally {
    stub.restore();
  }
  assert.equal((stub.requests[0]?.body as SlackBody).text, "🟢 GitHub — RESOLVED");
});

test("a non-2xx response rejects with the status code and Slack's own reason", async () => {
  const stub = stubFetch(() => new Response("invalid_payload", { status: 400 }));
  try {
    await createSlackNotifier(settings).send(opened);
    assert.fail("expected the send to reject");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(message.includes("400"), message);
    assert.ok(message.includes("invalid_payload"), message);
    // The webhook URL is the credential and never belongs in an error.
    assert.ok(!message.includes("secret"), message);
  } finally {
    stub.restore();
  }
});

test("the notifier refuses a missing or non-http webhook url", () => {
  assert.throws(() => createSlackNotifier({ webhookUrl: "" }), /webhookUrl/);
  assert.throws(() => createSlackNotifier({ webhookUrl: "slack://hooks" }), /webhookUrl/);
});

test("the notifier reports its channel id", () => {
  assert.equal(createSlackNotifier(settings).id, "slack");
});
