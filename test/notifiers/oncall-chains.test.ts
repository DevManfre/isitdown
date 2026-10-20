import { test } from "node:test";
import assert from "node:assert/strict";
import { createSplunkOncallNotifier } from "../../src/notifiers/splunk-oncall.notifier.ts";
import { createSquadcastNotifier } from "../../src/notifiers/squadcast.notifier.ts";
import { createZendutyNotifier } from "../../src/notifiers/zenduty.notifier.ts";
import { createIncidentIoNotifier } from "../../src/notifiers/incident-io.notifier.ts";
import { createGrafanaOncallNotifier } from "../../src/notifiers/grafana-oncall.notifier.ts";
import type { Notifier } from "../../src/core/notifier.interface.ts";
import type { NotificationPayload } from "../../src/core/types.ts";
import { jsonResponse, stubFetch, type CapturedRequest } from "../helpers/fetchStub.ts";
import { opened, payloadFor, resolved } from "./contract/fixtures.ts";

/**
 * The on-call chains added in roadmap 3.9. The contract suite already holds
 * them to one stable key per alert; what is left is each one's own word for
 * "this pages", "this does not" and "this is over", which is the part an
 * operator configures escalation policies against.
 */

type Body = Record<string, unknown>;

async function bodyOf(notifier: Notifier, payload: NotificationPayload): Promise<Body> {
  const stub = stubFetch(() => jsonResponse({}));
  try {
    await notifier.send(payload);
  } finally {
    stub.restore();
  }
  return (stub.requests.at(-1) as CapturedRequest).body as Body;
}

const digestOfRecovery: NotificationPayload = { ...resolved, digest: { items: [resolved], windowMinutes: 15 } };

const chains: {
  name: string;
  notifier: () => Notifier;
  field: string;
  trigger: unknown;
  quiet: unknown;
  resolve: unknown;
  missing: Record<string, string>;
}[] = [
  {
    name: "splunk-oncall",
    notifier: () => createSplunkOncallNotifier({ apiKey: "k", routingKey: "ops" }),
    field: "message_type",
    trigger: "CRITICAL",
    quiet: "WARNING",
    resolve: "RECOVERY",
    missing: { apiKey: "k", routingKey: "" },
  },
  {
    name: "squadcast",
    notifier: () => createSquadcastNotifier({ webhookUrl: "https://api.squadcast.com/v2/incidents/api/k" }),
    field: "status",
    trigger: "trigger",
    quiet: "trigger",
    resolve: "resolve",
    missing: { webhookUrl: "not a url" },
  },
  {
    name: "zenduty",
    notifier: () => createZendutyNotifier({ integrationKey: "k" }),
    field: "alert_type",
    trigger: "critical",
    quiet: "warning",
    resolve: "resolved",
    missing: { integrationKey: "" },
  },
  {
    name: "incident-io",
    notifier: () => createIncidentIoNotifier({ alertSourceId: "s", token: "t" }),
    field: "status",
    trigger: "firing",
    quiet: "firing",
    resolve: "resolved",
    missing: { alertSourceId: "s", token: "" },
  },
  {
    name: "grafana-oncall",
    notifier: () => createGrafanaOncallNotifier({ webhookUrl: "https://oncall.example.com/hook/t/" }),
    field: "state",
    trigger: "alerting",
    quiet: "alerting",
    resolve: "ok",
    missing: { webhookUrl: "" },
  },
];

for (const chain of chains) {
  test(`${chain.name}: a major outage pages, a degradation is quieter, a recovery closes`, async () => {
    const notifier = chain.notifier();
    assert.equal((await bodyOf(notifier, opened))[chain.field], chain.trigger);
    assert.equal((await bodyOf(notifier, payloadFor("status_change")))[chain.field], chain.quiet);
    assert.equal((await bodyOf(notifier, resolved))[chain.field], chain.resolve);
  });

  test(`${chain.name}: a digest never closes an alert, even when its worst member is a recovery`, async () => {
    assert.notEqual((await bodyOf(chain.notifier(), digestOfRecovery))[chain.field], chain.resolve);
  });

  test(`${chain.name}: settings without the credential are refused by name`, () => {
    const factory = {
      "splunk-oncall": createSplunkOncallNotifier,
      squadcast: createSquadcastNotifier,
      zenduty: createZendutyNotifier,
      "incident-io": createIncidentIoNotifier,
      "grafana-oncall": createGrafanaOncallNotifier,
    }[chain.name];
    assert.ok(factory !== undefined);
    assert.throws(() => factory(chain.missing), new RegExp(chain.name));
  });
}

test("incident-io: the alert source's token travels as a bearer header, not in the URL", async () => {
  const stub = stubFetch(() => jsonResponse({}, 202));
  try {
    await createIncidentIoNotifier({ alertSourceId: "01SRC", token: "tok" }).send(opened);
  } finally {
    stub.restore();
  }
  const [request] = stub.requests;
  assert.equal(request?.url, "https://api.incident.io/v2/alert_events/http/01SRC");
  assert.equal(request?.headers.authorization, "Bearer tok");
});

test("splunk-oncall: the state start time is the change's own, in epoch seconds", async () => {
  const body = await bodyOf(createSplunkOncallNotifier({ apiKey: "k", routingKey: "ops" }), opened);
  assert.equal(body.state_start_time, Date.parse(opened.change.at) / 1000);
});
