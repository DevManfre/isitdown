import { json, ref, ok } from "./shared.ts";
import type { Json } from "./shared.ts";

/** Health, readiness and the live status read. */
export const statusPaths: Json = {
  "/health": {
    get: {
      tags: ["Health"],
      summary: "Liveness, and only that: the process answers.",
      description: "Never fails because a provider is unreachable.",
      responses: { "200": ok(ref("Health")) },
    },
  },
  "/ready": {
    get: {
      tags: ["Health"],
      summary: "Readiness: whether polling is working.",
      description:
        "503 when no cycle has completed, the last one is more than three poll intervals old, or every provider failed in it. This is what the container healthcheck asks.",
      responses: {
        "200": ok(ref("Readiness")),
        "503": {
          description: "Polling is not working.",
          ...json(ref("Readiness")),
        },
      },
    },
  },
  "/status": {
    get: {
      tags: ["Status"],
      summary:
        "Current status of every provider, plus the poll clock and groups.",
      description:
        "A pure database read: safe to poll, never reaches upstream.",
      responses: { "200": ok(ref("StatusPayload")) },
    },
  },
};

/** Shapes this module's operations answer with, referenced as `#/components/schemas/<name>`. */
export const statusSchemas: Json = {};
