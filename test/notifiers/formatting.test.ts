import { test } from "node:test";
import assert from "node:assert/strict";
import { emojiFor, renderMessage, severityLabel } from "../../src/notifiers/formatting.ts";
import type { NotificationPayload, StatusChange } from "../../src/core/types.ts";

const service = { id: "github", name: "GitHub", statusUrl: "https://www.githubstatus.com" };

const payloadFor = (change: StatusChange, locale = "en"): NotificationPayload => ({
  change,
  service,
  locale,
});

const incident = {
  id: "i1",
  name: "API requests failing",
  impact: "major",
  status: "investigating",
  updatedAt: "2026-08-19T14:32:07.000Z",
};

const window = {
  id: "m1",
  name: "Scheduled database maintenance",
  status: "in_progress",
  startsAt: "2026-08-19T14:00:00.000Z",
  endsAt: "2026-08-19T16:00:00.000Z",
  componentIds: [],
};

const openEndedWindow = { ...window, endsAt: null };

test("each status has its own emoji and none is reused", () => {
  const emojis = (["operational", "degraded", "partial_outage", "major_outage", "unknown"] as const).map(
    emojiFor,
  );
  assert.equal(new Set(emojis).size, emojis.length);
  assert.equal(emojiFor("operational"), "🟢");
  assert.equal(emojiFor("major_outage"), "🔴");
});

test("the severity label is the translated status name, upper-cased", () => {
  assert.equal(severityLabel("major_outage", "en"), "MAJOR OUTAGE");
  assert.equal(severityLabel("operational", "it"), "OPERATIVO");
});

test("a status change renders both sides of the transition", () => {
  const message = renderMessage(
    payloadFor({
      kind: "status_change",
      providerId: "github",
      previousStatus: "operational",
      currentStatus: "major_outage",
      at: "2026-08-19T14:32:07.000Z",
    }),
  );
  assert.ok(message.startsWith("🔴 GitHub — MAJOR OUTAGE"), message);
  assert.ok(message.includes("Operational"));
  assert.ok(message.includes("Major outage"));
  assert.ok(message.includes("2026-08-19 14:32 UTC"));
  assert.ok(message.includes("https://www.githubstatus.com"));
});

test("an opened incident renders its title and lifecycle status", () => {
  const message = renderMessage(
    payloadFor({
      kind: "incident_opened",
      providerId: "github",
      currentStatus: "major_outage",
      incident,
      at: "2026-08-19T14:32:07.000Z",
    }),
  );
  assert.ok(message.includes("API requests failing"));
  assert.ok(message.includes("Investigating"));
});

test("a resolved incident is headed RESOLVED, not by the current status", () => {
  const message = renderMessage(
    payloadFor({
      kind: "incident_resolved",
      providerId: "github",
      previousStatus: "major_outage",
      currentStatus: "operational",
      incident,
      at: "2026-08-19T15:10:00.000Z",
    }),
  );
  assert.ok(message.startsWith("🟢 GitHub — RESOLVED"), message);
  assert.ok(message.includes("API requests failing"));
});

test("a monitoring degraded warning reports the failure count and last known status", () => {
  const message = renderMessage(
    payloadFor({
      kind: "monitoring_degraded",
      providerId: "github",
      currentStatus: "operational",
      failureCount: 5,
      at: "2026-08-19T14:32:07.000Z",
    }),
  );
  assert.ok(message.includes("5"));
  assert.ok(message.includes("Operational"));
  assert.ok(message.startsWith("⚪"), message);
});

test("a component change message names the component and uses its severity", () => {
  const text = renderMessage({
    change: {
      kind: "component_status_change",
      providerId: "github",
      previousStatus: "operational",
      currentStatus: "degraded",
      component: { id: "c1", name: "Actions" },
      at: "2026-08-19T14:05:00.000Z",
    },
    service: { id: "github", name: "GitHub", statusUrl: "https://www.githubstatus.com" },
    locale: "en",
  });
  assert.ok(text.startsWith("🟡"));
  assert.match(text, /GitHub — DEGRADED/);
  assert.match(text, /Component Actions changed from Operational to Degraded\./);
  assert.match(text, /https:\/\/www\.githubstatus\.com/);
});

test("an unknown provider lifecycle word falls through untranslated rather than blank", () => {
  const message = renderMessage(
    payloadFor({
      kind: "incident_opened",
      providerId: "github",
      currentStatus: "degraded",
      incident: { ...incident, status: "gremlins" },
      at: "2026-08-19T14:32:07.000Z",
    }),
  );
  assert.ok(message.includes("gremlins"));
});

test("no rendered message leaves an unfilled placeholder", () => {
  const changes: StatusChange[] = [
    { kind: "status_change", providerId: "github", previousStatus: "operational", currentStatus: "degraded", at: incident.updatedAt },
    { kind: "component_status_change", providerId: "github", previousStatus: "operational", currentStatus: "degraded", component: { id: "c1", name: "Actions" }, at: incident.updatedAt },
    { kind: "incident_opened", providerId: "github", currentStatus: "degraded", incident, at: incident.updatedAt },
    { kind: "incident_updated", providerId: "github", currentStatus: "degraded", incident, at: incident.updatedAt },
    { kind: "incident_resolved", providerId: "github", currentStatus: "operational", incident, at: incident.updatedAt },
    { kind: "monitoring_degraded", providerId: "github", currentStatus: "unknown", failureCount: 7, at: incident.updatedAt },
    { kind: "maintenance_started", providerId: "github", currentStatus: "operational", maintenance: window, at: window.startsAt },
    { kind: "maintenance_started", providerId: "github", currentStatus: "operational", maintenance: openEndedWindow, at: openEndedWindow.startsAt },
    { kind: "maintenance_ended", providerId: "github", currentStatus: "major_outage", maintenance: window, openIncidents: 2, at: window.endsAt as string },
  ];
  for (const locale of ["en", "it"]) {
    for (const change of changes) {
      const message = renderMessage(payloadFor(change, locale));
      assert.ok(!/\{\w+\}/.test(message), `${locale} ${change.kind}: ${message}`);
    }
  }
});

test("a starting window names the window and the provider", () => {
  const text = renderMessage(
    payloadFor({
      kind: "maintenance_started",
      providerId: "github",
      currentStatus: "operational",
      maintenance: window,
      at: window.startsAt,
    }),
  );
  assert.match(text, /Scheduled database maintenance/);
  assert.match(text, /GitHub/);
});

test("a starting window with no declared end says so instead of rendering nothing", () => {
  const text = renderMessage(
    payloadFor({
      kind: "maintenance_started",
      providerId: "github",
      currentStatus: "operational",
      maintenance: openEndedWindow,
      at: openEndedWindow.startsAt,
    }),
  );
  assert.match(text, /Ends: not stated/);
});

test("a window that ended clean says so", () => {
  const text = renderMessage(
    payloadFor({
      kind: "maintenance_ended",
      providerId: "github",
      currentStatus: "operational",
      maintenance: window,
      openIncidents: 0,
      at: window.endsAt,
    }),
  );
  assert.match(text, /Operational/);
});

test("a window that ended badly reports the state it left behind", () => {
  const text = renderMessage(
    payloadFor({
      kind: "maintenance_ended",
      providerId: "github",
      currentStatus: "major_outage",
      maintenance: window,
      openIncidents: 2,
      at: window.endsAt,
    }),
  );
  assert.match(text, /Major outage — 2 open incident\(s\)/);
});

test("both maintenance kinds render in italian too", () => {
  const started = renderMessage(
    payloadFor(
      {
        kind: "maintenance_started",
        providerId: "github",
        currentStatus: "operational",
        maintenance: window,
        at: window.startsAt,
      },
      "it",
    ),
  );
  assert.doesNotMatch(started, /notification\.maintenance/, "a missing key must not leak as a key");
  assert.match(started, /È iniziata una manutenzione programmata: Scheduled database maintenance/);

  const ended = renderMessage(
    payloadFor(
      {
        kind: "maintenance_ended",
        providerId: "github",
        currentStatus: "major_outage",
        maintenance: window,
        openIncidents: 2,
        at: window.endsAt,
      },
      "it",
    ),
  );
  assert.doesNotMatch(ended, /notification\.maintenance/, "a missing key must not leak as a key");
  assert.match(ended, /Interruzione grave — 2 incidente\/i aperto\/i/);
});

test("the italian rendering differs from the english one but keeps the same data", () => {
  const change: StatusChange = {
    kind: "incident_opened",
    providerId: "github",
    currentStatus: "degraded",
    incident,
    at: incident.updatedAt,
  };
  const en = renderMessage(payloadFor(change, "en"));
  const it = renderMessage(payloadFor(change, "it"));
  assert.notEqual(en, it);
  for (const message of [en, it]) {
    assert.ok(message.includes("API requests failing"));
    assert.ok(message.includes("2026-08-19 14:32 UTC"));
  }
});
