import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime } from "../../src/ui/runtime.ts";
import { openapiDocument } from "../../src/ui/openapi.ts";
import { createLogger } from "../../src/core/logger.ts";

/**
 * Roadmap 13.3, the request side: for every operation that documents a JSON
 * body, bodies the spec rules out — generated from the spec, not written by
 * hand — are refused with the 400 it promises. The response side rides along
 * every API test through `test/helpers/openapiContract.ts`.
 */

const silent = createLogger("error", () => {});
type Json = Record<string, unknown>;

interface Operation {
  method: string;
  path: string;
  schema: Json;
  documents400: boolean;
}

function jsonBodies(): Operation[] {
  const document = openapiDocument() as { paths: Record<string, Record<string, Json>> };
  const found: Operation[] = [];
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const body = operation["requestBody"] as { content?: Record<string, { schema?: Json }> } | undefined;
      const schema = body?.content?.["application/json"]?.schema;
      if (schema === undefined) continue;
      const responses = operation["responses"] as Record<string, unknown>;
      found.push({ method: method.toUpperCase(), path, schema, documents400: "400" in responses });
    }
  }
  return found;
}

/** A value of a JSON type other than every one `schema` allows. */
function wrongTypeFor(schema: Json): unknown {
  const allowed = new Set(
    Array.isArray(schema["type"]) ? (schema["type"] as string[]) : [schema["type"] as string | undefined],
  );
  if (allowed.has("integer")) allowed.add("number");
  const candidates: [string, unknown][] = [
    ["object", { unexpected: true }],
    ["string", "not-the-right-type"],
    ["array", ["not-the-right-type"]],
    ["boolean", true],
    ["number", 12345.5],
  ];
  return candidates.find(([type]) => !allowed.has(type))?.[1];
}

/** Bodies the schema rules out, each with what makes it invalid. */
export function invalidBodies(schema: Json): [string, unknown][] {
  const bodies: [string, unknown][] = [];
  if (schema["type"] === undefined) return bodies;
  bodies.push(["a body of the wrong JSON type", wrongTypeFor(schema)]);
  const required = (schema["required"] as string[] | undefined) ?? [];
  if (required.length > 0) bodies.push([`no ${required.join(", ")}`, {}]);
  const properties = (schema["properties"] as Record<string, Json> | undefined) ?? {};
  // Only a property the spec types is wrong-typed: an untyped one accepts anything.
  for (const [name, property] of Object.entries(properties)) {
    if (property["type"] === undefined) continue;
    bodies.push([`${name} of the wrong type`, { ...minimal(schema), [name]: wrongTypeFor(property) }]);
  }
  for (const [name, property] of Object.entries(properties)) {
    if (!Array.isArray(property["enum"])) continue;
    bodies.push([`${name} outside its enum`, { ...minimal(schema), [name]: "not-one-of-them" }]);
  }
  return bodies;
}

/** The documented required fields, each with a plausible value, so one field is wrong at a time. */
function minimal(schema: Json): Json {
  const properties = (schema["properties"] as Record<string, Json> | undefined) ?? {};
  const required = (schema["required"] as string[] | undefined) ?? [];
  return Object.fromEntries(required.map((name) => [name, plausible(properties[name] ?? {})]));
}

function plausible(schema: Json): unknown {
  if (Array.isArray(schema["enum"])) return schema["enum"][0];
  const type = Array.isArray(schema["type"]) ? schema["type"][0] : schema["type"];
  switch (type) {
    case "integer":
    case "number":
      return (schema["minimum"] as number | undefined) ?? 1;
    case "boolean":
      return true;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return schema["format"] === "date-time" ? new Date().toISOString() : "x";
  }
}

test("every operation with a JSON body documents the 400 that refuses a bad one", () => {
  const undocumented = jsonBodies()
    .filter((operation) => !operation.documents400)
    .map((operation) => `${operation.method} ${operation.path}`);
  assert.deepEqual(undocumented, []);
});

test("a body the spec rules out is refused with 400, for every operation that takes one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-openapi-requests-"));
  // A push is checked for its token before its body: with the feature on and
  // the token given, the body is what decides the answer.
  const runtime = await buildUiRuntime({
    dbPath: join(dir, "isitdown.db"),
    env: { PUSH_TOKEN: "contract" },
    logger: silent,
  });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    // Real ids for the path parameters, so a lookup that runs before validation
    // cannot answer 404 and hide whether validation happened at all.
    const provider = runtime.listAllServices()[0]?.id ?? "github";
    const dashboard = (await (
      await fetch(`${base}/dashboards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Contract" }),
      })
    ).json()) as { id: string };
    const ids: Record<string, string> = {
      providerId: provider,
      incidentId: "contract-incident",
      id: dashboard.id,
      credential: "key",
      field: "botToken",
      key: provider,
    };
    const idFor = (path: string, name: string): string => {
      if (name === "id" && path.startsWith("/config/services")) return provider;
      if (name === "id" && path.startsWith("/config/channels")) return "telegram";
      if (name === "id" && path.startsWith("/providers")) return provider;
      return ids[name] ?? "contract";
    };

    const accepted: string[] = [];
    for (const operation of jsonBodies()) {
      const url =
        operation.path.replace(/\{([A-Za-z]+)\}/g, (_match, name: string) =>
          encodeURIComponent(idFor(operation.path, name)),
        ) + (operation.path.startsWith("/push/") ? "?token=contract" : "");
      for (const [why, body] of invalidBodies(operation.schema)) {
        const response = await fetch(`${base}${url}`, {
          method: operation.method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        await response.arrayBuffer();
        if (response.status !== 400) {
          accepted.push(`${operation.method} ${operation.path} — ${why}: ${response.status}`);
        }
      }
    }
    assert.deepEqual(accepted, [], `answered something other than 400:\n${accepted.join("\n")}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close();
  }
});
