import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createWebhookNotifier } from "../../src/notifiers/webhook.notifier.ts";
import { WEBHOOK_SCHEMA_PATH, WEBHOOK_SCHEMA_VERSION, webhookJsonSchema } from "../../src/notifiers/webhookEvent.ts";
import type { NotificationPayload } from "../../src/core/types.ts";
import { closed } from "../helpers/openapiContract.ts";
import { stubFetch } from "../helpers/fetchStub.ts";
import { ALL_KINDS, AT, payloadFor } from "./contract/fixtures.ts";

const committed = JSON.parse(readFileSync(new URL(`../../${WEBHOOK_SCHEMA_PATH}`, import.meta.url), "utf8")) as object;

// Validated *closed*, the way the API contract is (test/helpers/openapiContract.ts):
// the published schema stays open so an added field never breaks a receiver,
// but here a field the body carries and the schema does not describe fails —
// otherwise the schema could fall behind the notifier and still pass.
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(closed(committed) as object);

async function bodyOf(payload: NotificationPayload): Promise<unknown> {
  const stub = stubFetch(() => new Response(null, { status: 204 }));
  try {
    await createWebhookNotifier({ url: "https://hooks.example/isitdown" }).send(payload);
  } finally {
    stub.restore();
  }
  return JSON.parse(stub.requests[0]?.rawBody ?? "null") as unknown;
}

/** Every kind, plus the optional fields the per-kind fixtures leave out. */
const CASES: [string, NotificationPayload][] = [
  ...ALL_KINDS.map((kind): [string, NotificationPayload] => [kind, payloadFor(kind)]),
  [
    "incident with a declared creation time",
    payloadFor("incident_opened", {
      incident: { id: "i", name: "n", impact: "minor", status: "investigating", updatedAt: AT, createdAt: AT },
    }),
  ],
  [
    "operator notes and a chart",
    {
      ...payloadFor("status_change"),
      service: { id: "github", name: "GitHub", statusUrl: "https://www.githubstatus.com", impact: "CI stops", owner: "Platform", runbook: "https://wiki/r" },
      chart: { svg: "<svg/>", filename: "github.svg" },
    },
  ],
  ["silent outage with an authority", payloadFor("silent_outage", { crossCheck: { probeId: "p", authority: "declared" } })],
  [
    "report with favourites",
    payloadFor("periodic_report", {
      report: {
        frequency: "monthly", from: "2026-08-01", to: "2026-08-31", fleetUptime: null, incidentCount: 0,
        worst: [], favorites: [{ providerId: "github", uptime: null }], sla: [],
      },
    }),
  ],
];

for (const [name, payload] of CASES) {
  test(`the webhook body validates against the published schema: ${name}`, async () => {
    const body = await bodyOf(payload);
    assert.ok(validate(body), JSON.stringify(validate.errors, null, 2));
    assert.equal((body as { schemaVersion: number }).schemaVersion, WEBHOOK_SCHEMA_VERSION);
  });
}

test("a field the schema does not describe fails validation", () => {
  const body = { schemaVersion: 1, change: { kind: "status_change", providerId: "x", currentStatus: "degraded", at: AT, surprise: 1 }, service: { id: "x", name: "X", statusUrl: "https://x" }, message: "m" };
  assert.equal(validate(body), false);
});

test("the published schema stays open, so an added field does not break a receiver", () => {
  const open = new Ajv2020({ strict: false }).compile(committed);
  const body = { schemaVersion: 1, change: { kind: "status_change", providerId: "x", currentStatus: "degraded", at: AT, addedLater: 1 }, service: { id: "x", name: "X", statusUrl: "https://x" }, message: "m", alsoLater: true };
  assert.ok(open(body), JSON.stringify(open.errors));
});

test("the committed schema is the one generated from the zod definition", () => {
  assert.deepEqual(committed, webhookJsonSchema(), `${WEBHOOK_SCHEMA_PATH} is stale: run node tools/webhook-schema.mjs`);
});
