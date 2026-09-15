import { test } from "node:test";
import assert from "node:assert/strict";
import { createTeamsNotifier } from "../../src/notifiers/teams.notifier.ts";
import { stubFetch } from "../helpers/fetchStub.ts";
import type { NotificationPayload } from "../../src/core/types.ts";

const webhookUrl = "https://prod-1.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=SignatureSecret";
const settings = { webhookUrl };

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

type TeamsBody = {
  type: string;
  attachments: {
    contentType: string;
    content: {
      type: string;
      body: { type: string; text: string; color?: string }[];
      actions: { type: string; title: string; url: string }[];
    };
  }[];
};

const okResponse = (): Response => new Response("", { status: 202 });

const card = (body: unknown): TeamsBody["attachments"][0]["content"] =>
  (body as TeamsBody).attachments[0]!.content;

test("an opened incident posts an adaptive card in the attachments envelope", async () => {
  const stub = stubFetch(okResponse);
  try {
    await createTeamsNotifier(settings).send(opened);
  } finally {
    stub.restore();
  }

  const request = stub.requests[0];
  assert.equal(request?.url, webhookUrl);
  assert.equal(request?.method, "POST");
  assert.equal(request?.headers["content-type"], "application/json");

  const envelope = request?.body as TeamsBody;
  assert.equal(envelope.type, "message");
  assert.equal(envelope.attachments[0]?.contentType, "application/vnd.microsoft.card.adaptive");
  assert.equal(card(request?.body).type, "AdaptiveCard");

  const blocks = card(request?.body).body;
  assert.ok(blocks[0]?.text.includes("MAJOR OUTAGE"), blocks[0]?.text);
  assert.ok(blocks[1]?.text.includes("API requests failing"), blocks[1]?.text);
  // The status page is a button, not a line in the text.
  assert.ok(!blocks[1]?.text.includes("githubstatus.com"), blocks[1]?.text);
});

test("the status page is the card's only action", async () => {
  const stub = stubFetch(okResponse);
  try {
    await createTeamsNotifier(settings).send(opened);
  } finally {
    stub.restore();
  }

  assert.deepEqual(card(stub.requests[0]?.body).actions, [
    { type: "Action.OpenUrl", title: "GitHub", url: "https://www.githubstatus.com" },
  ]);
});

test("severity is the heading's colour, read from the client rather than sent as a hex", async () => {
  const stub = stubFetch(okResponse);
  try {
    const notifier = createTeamsNotifier(settings);
    await notifier.send(opened);
    await notifier.send({ ...opened, change: { ...opened.change, currentStatus: "degraded" } });
    await notifier.send({
      ...opened,
      change: { ...opened.change, kind: "incident_resolved", currentStatus: "operational" },
    });
    await notifier.send({
      ...opened,
      change: { ...opened.change, kind: "monitoring_degraded", currentStatus: "unknown" },
    });
  } finally {
    stub.restore();
  }

  assert.deepEqual(
    stub.requests.map((request) => card(request.body).body[0]?.color),
    ["attention", "warning", "good", "default"],
  );
});

test("a non-2xx response rejects with the status and the reason, never the webhook URL", async () => {
  const stub = stubFetch(() => new Response("Workflow trigger not found", { status: 404 }));
  try {
    await createTeamsNotifier(settings).send(opened);
    assert.fail("expected send to reject");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(message.includes("404"), message);
    assert.ok(message.includes("Workflow trigger not found"), message);
    assert.ok(!message.includes("SignatureSecret"), message);
  } finally {
    stub.restore();
  }
});

test("the notifier refuses a missing or non-http webhook url", () => {
  assert.throws(() => createTeamsNotifier({ webhookUrl: "" }), /webhookUrl/);
  assert.throws(() => createTeamsNotifier({ webhookUrl: "teams://channel" }), /webhookUrl/);
});

test("the notifier reports its channel id", () => {
  assert.equal(createTeamsNotifier(settings).id, "teams");
});
