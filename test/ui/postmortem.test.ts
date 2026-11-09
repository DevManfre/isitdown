import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPostmortem, type PostmortemInput } from "../../src/ui/postmortem.ts";

const input = (over: Partial<PostmortemInput> = {}): PostmortemInput => ({
  providerName: "GitHub",
  incident: {
    providerId: "github",
    incidentId: "i1",
    name: "Git operations degraded",
    impact: "major",
    status: "resolved",
    startedAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T11:30:00.000Z",
    resolvedAt: "2026-08-10T11:30:00.000Z",
  },
  cost: null,
  timeline: [
    { at: "2026-08-10T10:00:00.000Z", label: "opened", status: "investigating" },
    { at: "2026-08-10T11:30:00.000Z", label: "resolved" },
  ],
  revisions: [],
  notifications: [],
  notes: [],
  annotations: [],
  overlapping: [],
  generatedAt: "2026-08-11T07:00:00.000Z",
  ...over,
});

test("a postmortem names the incident, its window and how long it lasted", () => {
  const md = renderPostmortem(input());
  assert.ok(md.startsWith("# Postmortem — Git operations degraded"));
  assert.ok(md.includes("**Provider:** GitHub"));
  assert.ok(md.includes("**Duration:** 1 h 30 m"));
  assert.ok(md.includes("2026-08-10T10:00:00.000Z"));
});

test("an open incident says it is still open and is measured to the moment of writing", () => {
  const md = renderPostmortem(
    input({ incident: { ...input().incident, resolvedAt: null, status: "investigating" } }),
  );
  assert.ok(md.includes("still open"));
  assert.ok(md.includes("**Duration:** 21 h")); // 10:00 on the 10th to 07:00 on the 11th
});

test("cost appears only when a rate was declared", () => {
  assert.ok(!renderPostmortem(input()).includes("Cost"));
  assert.ok(renderPostmortem(input({ cost: 1800 })).includes("**Estimated cost:** 1800.00"));
});

test("everything that happened lands on one timeline, in order", () => {
  const md = renderPostmortem(
    input({
      notifications: [
        { providerId: "github", channel: "telegram", kind: "incident_opened", text: "GitHub is down", sentAt: "2026-08-10T10:01:00.000Z", ok: true, attempts: 1 },
      ],
      notes: [{ id: 1, body: "Rolled back the deploy", createdAt: "2026-08-10T10:20:00.000Z" }],
      annotations: [{ id: 1, at: "2026-08-10T09:55:00.000Z", label: "Deploy v2.4.0", colour: "warn", providerId: null, createdAt: "2026-08-10T09:56:00.000Z" }],
      revisions: [{ field: "impact", before: "minor", after: "major", observedAt: "2026-08-10T10:40:00.000Z" }],
    }),
  );
  const order = ["Deploy v2.4.0", "Incident opened", "Notified telegram", "Rolled back the deploy", "impact changed", "Incident resolved"].map(
    (needle) => md.indexOf(needle),
  );
  assert.ok(order.every((at) => at >= 0), `every entry is present: ${order.join(",")}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("providers down at the same time are listed and drawn", () => {
  const md = renderPostmortem(
    input({
      overlapping: [
        { providerName: "Cloudflare", startedAt: "2026-08-10T09:50:00.000Z", resolvedAt: "2026-08-10T10:30:00.000Z", name: "Edge: errors" },
      ],
    }),
  );
  assert.ok(md.includes("## Providers down at the same time"));
  assert.ok(md.includes("Cloudflare"));
  assert.ok(md.includes("```mermaid"));
  assert.ok(md.includes("gantt"));
  // A colon inside a task name would end the name early in Mermaid.
  assert.ok(!/Edge: errors\s*:/.test(md));
});

test("a table cell or note cannot break the document with its own markup", () => {
  const md = renderPostmortem(input({ incident: { ...input().incident, name: "a | b" } }));
  assert.ok(md.includes("a \\| b"));
});
