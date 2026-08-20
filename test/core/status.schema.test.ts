import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizedStatusSchema, providerRuntimeStateSchema } from "../../src/core/status.schema.ts";

test("legacy persisted status without components parses to an empty array", () => {
  const parsed = normalizedStatusSchema.parse({
    provider: "github",
    overallStatus: "operational",
    activeIncidents: [],
    fetchedAt: "2026-08-19T14:05:00.000Z",
  });
  assert.deepEqual(parsed.components, []);
});

test("components round-trip through the schema", () => {
  const parsed = normalizedStatusSchema.parse({
    provider: "github",
    overallStatus: "operational",
    activeIncidents: [],
    components: [{ id: "c1", name: "Actions", status: "degraded" }],
    fetchedAt: "2026-08-19T14:05:00.000Z",
  });
  assert.deepEqual(parsed.components, [{ id: "c1", name: "Actions", status: "degraded" }]);
});

test("legacy runtime state without components still parses", () => {
  const parsed = providerRuntimeStateSchema.parse({
    last: {
      provider: "github",
      overallStatus: "operational",
      activeIncidents: [],
      fetchedAt: "2026-08-19T14:05:00.000Z",
    },
    failureCount: 0,
    degradedNotified: false,
  });
  assert.deepEqual(parsed.last?.components, []);
});
