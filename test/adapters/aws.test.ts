import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { awsAdapter, parseAwsStatus } from "../../src/adapters/aws.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { resetValidators } from "../../src/core/http.ts";
import { withServer } from "../helpers/localServer.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = {
  id: "aws",
  name: "AWS",
  baseUrl: "https://health.aws.amazon.com",
};

/**
 * Recorded from the live feed (`npm run record-fixture`), trimmed to one event
 * with a short log. `operational.json` is the empty list the feed answers with
 * while nothing is open, and `informational.json` the same recorded event moved
 * to the advisory code.
 */
const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/aws/${name}.json`, import.meta.url), "utf8");

const event = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  arn: "arn:aws:health:eu-west-1::event/EC2/AWS_EC2_OPERATIONAL_ISSUE/AWS_EC2_OPERATIONAL_ISSUE_1",
  date: "1772369485",
  status: "3",
  service: "ec2-eu-west-1",
  service_name: "Amazon Elastic Compute Cloud",
  region_name: "Ireland",
  summary: "Increased Error Rates",
  event_log: [{ summary: "Increased Error Rates", message: "We are investigating.", status: 1, timestamp: 1772369485 }],
  ...over,
});

const feed = (...events: Record<string, unknown>[]): string => JSON.stringify(events);

runAdapterContract("aws", () => ({
  adapter: awsAdapter,
  service: (baseUrl) => ({ ...service, baseUrl }),
  ok: { "/public/currentevents": fixture("incident") },
  // Nothing but the arn an event is identifiable by.
  degraded: {
    "/public/currentevents": JSON.stringify([
      { arn: "arn:aws:health:eu-west-1::event/EC2/AWS_EC2_OPERATIONAL_ISSUE/AWS_EC2_OPERATIONAL_ISSUE_1" },
    ]),
  },
}));

test("an open disruption is reported as an outage, named by service, region and symptom", () => {
  const status = parseAwsStatus(fixture("incident"), service);

  assert.equal(status.provider, "aws");
  assert.equal(status.overallStatus, "major_outage");
  assert.equal(status.activeIncidents.length, 1);
  const [incident] = status.activeIncidents;
  assert.match(incident!.name, /Multiple services — UAE — Increased Error Rates/);
  assert.equal(incident!.impact, "major_outage");
  assert.equal(incident!.status, "disruption");
  // The newest log entry is what "updated" means for an event AWS is still
  // speaking about.
  const newest = Math.max(
    ...(JSON.parse(fixture("incident")) as { event_log: { timestamp: number }[] }[])[0]!.event_log.map(
      (entry) => entry.timestamp,
    ),
  );
  assert.equal(incident!.updatedAt, new Date(newest * 1000).toISOString());
});

test("an empty feed is a healthy fleet, not an unknown one", () => {
  const status = parseAwsStatus(fixture("operational"), service);

  assert.equal(status.overallStatus, "operational");
  assert.deepEqual(status.activeIncidents, []);
});

test("an informational event is surfaced without moving the status", () => {
  const status = parseAwsStatus(fixture("informational"), service);

  assert.equal(status.overallStatus, "operational");
  assert.equal(status.activeIncidents.length, 1);
  assert.equal(status.activeIncidents[0]?.status, "informational");
});

test("a degradation is reported as degraded rather than as an outage", () => {
  const status = parseAwsStatus(feed(event({ status: "2" })), service);

  assert.equal(status.overallStatus, "degraded");
  assert.equal(status.activeIncidents[0]?.status, "degradation");
});

test("a status code nothing knows about reads as an outage", () => {
  const status = parseAwsStatus(feed(event({ status: "9" })), service);

  assert.equal(status.overallStatus, "major_outage");
});

test("a closed event drops out instead of keeping a recovered region red", () => {
  const status = parseAwsStatus(feed(event({ status: "0" })), service);

  assert.equal(status.overallStatus, "operational");
  assert.deepEqual(status.activeIncidents, []);
});

test("an event without an arn is dropped rather than given an invented id", () => {
  const status = parseAwsStatus(feed(event({ arn: undefined })), service);

  assert.deepEqual(status.activeIncidents, []);
});

test("the region option narrows the feed to the region the operator runs in", () => {
  const scoped = { ...service, options: { region: "eu-west-1" } };
  const raw = feed(
    event(),
    event({
      arn: "arn:aws:health:us-east-1::event/EC2/AWS_EC2_OPERATIONAL_ISSUE/AWS_EC2_OPERATIONAL_ISSUE_2",
      service: "ec2-us-east-1",
      region_name: "N. Virginia",
    }),
  );

  const status = parseAwsStatus(raw, scoped);

  assert.equal(status.activeIncidents.length, 1);
  assert.match(status.activeIncidents[0]!.name, /Ireland/);
});

test("a global event is reported even to a region-scoped provider", () => {
  const scoped = { ...service, options: { region: "eu-west-1" } };
  const raw = feed(event({ arn: "arn:aws:health:::event/GLOBAL/AWS_GLOBAL_ISSUE/AWS_GLOBAL_ISSUE_1", service: "iam" }));

  const status = parseAwsStatus(raw, scoped);

  // Narrowing must never hide the one class of event that hits every region.
  assert.equal(status.activeIncidents.length, 1);
});

test("a body that is not the event list rejects rather than reading as calm", () => {
  assert.throws(() => parseAwsStatus(JSON.stringify({ events: [] }), service), /not an event list/);
  assert.throws(() => parseAwsStatus("<html></html>", service), /not JSON/);
});

test("the feed's UTF-16 body is read through to a status", async () => {
  resetValidators();
  const utf16 = Buffer.from(`﻿${fixture("incident")}`, "utf16le").swap16();
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json;charset=utf-16" });
      res.end(utf16);
    },
    async (baseUrl) => {
      const status = await awsAdapter.fetchStatus({ ...service, baseUrl }, { timeoutMs: 2000 });
      assert.equal(status.overallStatus, "major_outage");
    },
  );
});
