/// <reference types="node" />
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildEvents, groupSends, lifeline, verdictOf } from "./incidentStory.ts";
import type { IncidentRow, OverallStatus, SampleRow, SentRecord } from "./types.ts";

const MIN = 60_000;
const START = Date.parse("2026-08-21T09:00:00Z");
const at = (minutes: number): string => new Date(START + minutes * MIN).toISOString();

const incident = (over: Partial<IncidentRow> = {}): IncidentRow => ({
  providerId: "github", incidentId: "i1", name: "API errors", impact: "major", status: "investigating",
  startedAt: at(0), updatedAt: at(10), resolvedAt: null, ...over,
});

/** Newest first, the order the API sends them in. */
const poll = (minutes: number, overallStatus: OverallStatus): SampleRow =>
  ({ observedAt: at(minutes), overallStatus, ok: overallStatus === "operational" });

const send = (minutes: number, ok = true, channel = "telegram"): SentRecord => ({
  providerId: "github", channel, kind: "incident_opened", text: "x", sentAt: at(minutes), ok,
});

describe("groupSends", () => {
  it("folds sends close together into one burst, newest first", () => {
    const bursts = groupSends([send(12), send(11, false, "slack"), send(10, true, "webhook"), send(60)]);
    expect(bursts).toHaveLength(2);
    expect(bursts[0]?.records).toHaveLength(1);
    expect(bursts[1]?.records.map((record) => record.channel)).toEqual(["webhook", "slack", "telegram"]);
    expect(bursts[1]?.failed).toBe(1);
    expect(bursts[1]?.delivered).toBe(2);
  });

  it("returns nothing for an empty log", () => {
    expect(groupSends([])).toEqual([]);
  });
});

describe("verdictOf", () => {
  it("says an open incident the provider reads fine on is waiting to be closed by the provider", () => {
    const polls = [poll(50, "operational"), poll(47, "operational"), poll(44, "operational"), poll(10, "major_outage")];
    expect(verdictOf({ incident: incident(), polls, actionLog: [], nowMs: START + 51 * MIN })).toMatchObject({
      kind: "recovered", operationalPolls: 3,
    });
  });

  it("does not claim recovery on one good poll", () => {
    const polls = [poll(50, "operational"), poll(47, "major_outage")];
    expect(verdictOf({ incident: incident(), polls, actionLog: [], nowMs: START + 51 * MIN }).kind).toBe("active");
  });

  it("counts what failed to send on an active incident", () => {
    const verdict = verdictOf({
      incident: incident(), polls: [poll(5, "major_outage")], actionLog: [send(1, false), send(1), send(2)], nowMs: START + 6 * MIN,
    });
    expect(verdict).toMatchObject({ kind: "active", sent: 3, failed: 1 });
  });

  it("reports a resolved incident with its length", () => {
    const resolved = incident({ resolvedAt: at(90), status: "resolved" });
    expect(verdictOf({ incident: resolved, polls: [], actionLog: [send(1)], nowMs: START + 999 * MIN })).toMatchObject({
      kind: "resolved", sent: 1, failed: 0, minutes: 90,
    });
  });
});

describe("lifeline", () => {
  const base = { notes: [], buckets: 10 };

  it("reads the worst poll in each slice of the incident", () => {
    const polls = [poll(95, "operational"), poll(60, "major_outage"), poll(30, "degraded"), poll(5, "operational")];
    const line = lifeline({ ...base, incident: incident(), polls, actionLog: [], nowMs: START + 100 * MIN });
    expect(line.segments).toEqual(["ok", "none", "none", "degraded", "none", "none", "down", "none", "none", "ok"]);
    expect(line.open).toBe(true);
  });

  it("marks a slice no poll was kept for as unmeasured, not as fine", () => {
    const line = lifeline({ ...base, incident: incident(), polls: [], actionLog: [], nowMs: START + 100 * MIN });
    expect(new Set(line.segments)).toEqual(new Set(["none"]));
  });

  it("places opened, sends, notes and now along the span", () => {
    const line = lifeline({
      ...base, incident: incident(), polls: [], nowMs: START + 100 * MIN,
      actionLog: [send(10, false)], notes: [{ id: 1, body: "b", createdAt: at(50) }],
    });
    expect(line.markers.map((marker) => [marker.kind, Math.round(marker.pct)])).toEqual([
      ["opened", 0], ["failed", 10], ["note", 50], ["now", 100],
    ]);
  });

  it("ends a resolved incident at its resolution, not at now", () => {
    const line = lifeline({
      ...base, incident: incident({ resolvedAt: at(60), status: "resolved" }), polls: [], actionLog: [], nowMs: START + 999 * MIN,
    });
    expect(line.open).toBe(false);
    expect(line.toIso).toBe(at(60));
    expect(line.markers.at(-1)?.kind).toBe("resolved");
  });

  it("keeps a send made after the resolution on the line's right edge", () => {
    const line = lifeline({
      ...base, incident: incident({ resolvedAt: at(60), status: "resolved" }), polls: [], notes: [],
      actionLog: [send(62)], nowMs: START + 999 * MIN,
    });
    expect(line.markers.find((marker) => marker.kind === "alert")?.pct).toBe(100);
  });
});

describe("buildEvents", () => {
  it("merges observations, sends, notes and provider edits into one list, newest first", () => {
    const events = buildEvents({
      incident: incident({ resolvedAt: at(90), status: "resolved" }),
      timeline: [
        { at: at(0), label: "opened", status: "investigating" },
        { at: at(30), label: "observed", status: "operational" },
        { at: at(90), label: "resolved" },
      ],
      actionLog: [send(91), send(1), send(2, false, "slack")],
      notes: [{ id: 1, body: "b", createdAt: at(20) }],
      revisions: [{ field: "impact", before: "minor", after: "major", observedAt: at(40) }],
    });
    expect(events.map((event) => event.type)).toEqual([
      "sends", "resolved", "revision", "observed", "note", "sends", "opened",
    ]);
  });

  it("carries the provider's announcement time onto the opening, when the page published one", () => {
    const [opened] = buildEvents({
      incident: incident({ declaredAt: at(-3), firstSeenAt: at(0) }),
      timeline: [{ at: at(0), label: "opened", status: "investigating" }],
      actionLog: [], notes: [], revisions: [],
    });
    expect(opened).toMatchObject({ type: "opened", declaredAt: at(-3), firstSeenAt: at(0) });
  });
});
