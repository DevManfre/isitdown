import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpsgenieNotifier } from "../../src/notifiers/opsgenie.notifier.ts";
import { jsonResponse, stubFetch } from "../helpers/fetchStub.ts";
import type { NotificationPayload } from "../../src/core/types.ts";

const settings = { apiKey: "genie-SecretKey" };

const incident = {
  id: "i1",
  name: "API requests failing",
  impact: "major",
  status: "investigating",
  updatedAt: "2026-08-19T14:32:07.000Z",
};

const opened: NotificationPayload = {
  change: {
    kind: "incident_opened",
    providerId: "github",
    currentStatus: "major_outage",
    incident,
    at: "2026-08-19T14:32:07.000Z",
  },
  service: { id: "github", name: "GitHub", statusUrl: "https://www.githubstatus.com" },
  locale: "en",
};

const resolved: NotificationPayload = {
  ...opened,
  change: {
    ...opened.change,
    kind: "incident_resolved",
    currentStatus: "operational",
    incident: { ...incident, status: "resolved" },
  },
};

type Alert = { message: string; alias: string; description: string; priority: string };

const ok = (): Response => jsonResponse({ result: "Request will be processed" }, 202);

test("an opened incident creates an alert aliased on the change, at the reading's priority", async () => {
  const stub = stubFetch(ok);
  try {
    await createOpsgenieNotifier(settings).send(opened);
  } finally {
    stub.restore();
  }

  const [request] = stub.requests;
  assert.equal(request?.url, "https://api.opsgenie.com/v2/alerts");
  assert.equal(request?.method, "POST");
  const alert = request?.body as Alert;
  assert.equal(alert.message, "🔴 GitHub — MAJOR OUTAGE");
  assert.equal(alert.priority, "P1");
  assert.ok(alert.alias.includes("github"), alert.alias);
  assert.ok(alert.description.includes("API requests failing"), alert.description);
  assert.ok(alert.description.includes("https://www.githubstatus.com"), alert.description);
});

test("a resolution closes the very alias the alert was opened under", async () => {
  const stub = stubFetch(ok);
  try {
    const notifier = createOpsgenieNotifier(settings);
    await notifier.send(opened);
    await notifier.send(resolved);
  } finally {
    stub.restore();
  }

  const alias = (stub.requests[0]?.body as Alert).alias;
  assert.equal(
    stub.requests[1]?.url,
    `https://api.opsgenie.com/v2/alerts/${encodeURIComponent(alias)}/close?identifierType=alias`,
  );
  assert.equal(stub.requests[1]?.method, "POST");
});

test("a message longer than Opsgenie's cap is cut here rather than truncated silently", async () => {
  const stub = stubFetch(ok);
  try {
    await createOpsgenieNotifier(settings).send({
      ...opened,
      service: { ...opened.service, name: "A".repeat(200) },
    });
  } finally {
    stub.restore();
  }
  assert.equal((stub.requests[0]?.body as Alert).message.length, 130);
});

test("a digest never closes an alert", async () => {
  const stub = stubFetch(ok);
  try {
    await createOpsgenieNotifier(settings).send({
      ...resolved,
      digest: { items: [resolved, opened], windowMinutes: 5 },
    });
  } finally {
    stub.restore();
  }
  assert.equal(stub.requests[0]?.url, "https://api.opsgenie.com/v2/alerts");
});

test("an account on the EU instance talks to the EU host", async () => {
  const stub = stubFetch(ok);
  try {
    await createOpsgenieNotifier({ ...settings, region: "eu" }).send(opened);
  } finally {
    stub.restore();
  }
  assert.equal(stub.requests[0]?.url, "https://api.eu.opsgenie.com/v2/alerts");
});

test("the API key travels as a GenieKey header, never in the URL", async () => {
  const stub = stubFetch(ok);
  try {
    await createOpsgenieNotifier(settings).send(opened);
  } finally {
    stub.restore();
  }
  assert.equal(stub.requests[0]?.headers["authorization"], "GenieKey genie-SecretKey");
  assert.ok(!stub.requests[0]?.url.includes("genie-SecretKey"), stub.requests[0]?.url);
});

test("closing an alias Opsgenie never saw is reported, not swallowed", async () => {
  const stub = stubFetch(() => jsonResponse({ message: "Alert not found" }, 404));
  try {
    await createOpsgenieNotifier(settings).send(resolved);
    assert.fail("expected the close to reject");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(message.includes("404"), message);
    assert.ok(message.includes("Alert not found"), message);
    assert.ok(!message.includes("genie-SecretKey"), message);
  } finally {
    stub.restore();
  }
});

test("the notifier refuses a missing API key or an unknown region", () => {
  assert.throws(() => createOpsgenieNotifier({ apiKey: "" }), /apiKey/);
  assert.throws(() => createOpsgenieNotifier({ ...settings, region: "apac" }), /region/);
});

test("the notifier reports its channel id", () => {
  assert.equal(createOpsgenieNotifier(settings).id, "opsgenie");
});
