/**
 * Roadmap 13.3: every JSON response the test suites provoke is checked against
 * the shape `src/ui/openapi.ts` documents for it. Loaded with `--import` by the
 * test scripts, so it rides along every existing API test instead of asking
 * each one to remember a validation call.
 *
 * It patches `express.response.json` — the one door every JSON body leaves
 * through, `res.send(object)` included — looks up the operation by the
 * matched route and the status, and validates the body. A mismatch does not
 * change the response (the test under way still sees what the server sent);
 * it is recorded, and the process exits non-zero listing every one, which
 * `node --test` reports as that file failing.
 *
 * The document is validated *stricter* than it reads: an object schema that
 * does not say what else it allows allows nothing else. The published spec
 * stays open — a field added later is not a breaking change for a client —
 * but here an undocumented field is a failure, so the spec cannot fall
 * behind the code. A schema that really is an open map says so with
 * `additionalProperties`.
 */
import express, { type Request } from "express";
import { appendFileSync } from "node:fs";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { openapiDocument } from "../../src/ui/openapi.ts";

type Json = Record<string, unknown>;

/** `/config/services/:id` in Express is `/config/services/{id}` in OpenAPI. */
export const asOpenApiPath = (path: string): string =>
  path.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/\{providerId\}\.svg/, "{providerId}.svg");

/** Closes every object schema that does not declare what else it accepts. */
export function closed(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(closed);
  if (schema === null || typeof schema !== "object") return schema;
  const out: Json = {};
  for (const [key, value] of Object.entries(schema as Json)) {
    // `properties` and the like are maps of name → schema, not schemas.
    out[key] =
      key === "properties" || key === "patternProperties" || key === "$defs"
        ? Object.fromEntries(Object.entries(value as Json).map(([name, sub]) => [name, closed(sub)]))
        : key === "enum" || key === "const" || key === "example" || key === "examples" || key === "required"
          ? value
          : closed(value);
  }
  const type = out["type"];
  const isObject = type === "object" || (Array.isArray(type) && type.includes("object")) || "properties" in out;
  const open = "additionalProperties" in out || "unevaluatedProperties" in out || "patternProperties" in out;
  if (isObject && !open) out["unevaluatedProperties"] = false;
  return out;
}

export interface ContractViolation {
  operation: string;
  status: number;
  problem: string;
}

/**
 * The validator for one operation's response, by OpenAPI path, method and
 * status. `undefined` when the operation documents that status with no JSON
 * body; a string when it does not document it at all.
 */
export function contract() {
  const document = openapiDocument() as { paths: Record<string, Record<string, Json>>; components: Json };
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  ajv.addSchema({ $id: "openapi", components: closed(document.components) } as Json);
  const cache = new Map<string, ValidateFunction | undefined | string>();

  return (path: string, method: string, status: number): ValidateFunction | undefined | string => {
    const key = `${method} ${path} ${status}`;
    if (cache.has(key)) return cache.get(key);
    const operation = document.paths[path]?.[method.toLowerCase()] as { responses?: Record<string, Json> } | undefined;
    let found: ValidateFunction | undefined | string;
    if (operation === undefined) found = "operation not documented";
    else {
      const response = operation.responses?.[String(status)] ?? operation.responses?.["default"];
      if (response === undefined) found = `status ${status} not documented`;
      else {
        const content = response["content"] as Record<string, { schema?: Json }> | undefined;
        const schema = content?.["application/json"]?.schema;
        if (content !== undefined && schema === undefined) found = "answers JSON where the spec documents another media type";
        else if (schema === undefined) found = "answers a body where the spec documents none";
        else {
          const rewritten = JSON.parse(
            JSON.stringify(closed(schema)).replaceAll('"#/components/', '"openapi#/components/'),
          ) as Json;
          found = ajv.compile(rewritten);
        }
      }
    }
    cache.set(key, found);
    return found;
  };
}

const violations = new Map<string, ContractViolation>();
const lookup = contract();
const original = express.response.json;

express.response.json = function json(this: express.Response, body?: unknown) {
  const req = this.req as Request;
  const route = req.route as { path?: unknown } | undefined;
  // A 404 from the fallback has no route; a 500 is the error handler's, whose
  // shape is the generic error and says nothing about the route's contract.
  if (typeof route?.path === "string" && this.statusCode !== 500) {
    const path = asOpenApiPath(`${req.baseUrl}${route.path}`);
    const operation = `${req.method} ${path}`;
    const status = this.statusCode;
    const validate = lookup(path, req.method, status);
    const problem =
      typeof validate === "string"
        ? validate
        : validate !== undefined && !validate(JSON.parse(JSON.stringify(body ?? null)))
          ? (validate.errors ?? [])
              .map((error) => `${error.instancePath || "/"} ${error.message ?? ""}${error.params && "unevaluatedProperty" in error.params ? ` (${String(error.params["unevaluatedProperty"])})` : ""}`)
              .join("; ")
          : undefined;
    if (process.env["CONTRACT_SAMPLES"]) {
      appendFileSync(process.env["CONTRACT_SAMPLES"], JSON.stringify({ operation, status, body }) + "\n");
    }
    if (problem !== undefined) violations.set(`${operation} ${status} ${problem}`, { operation, status, problem });
  }
  return original.call(this, body);
};

process.on("exit", () => {
  if (violations.size === 0) return;
  const lines = [...violations.values()].map((v) => `  ${v.operation} → ${v.status}: ${v.problem}`);
  process.stderr.write(`\nOpenAPI contract: ${violations.size} response(s) the spec does not describe\n${lines.join("\n")}\n`);
  process.exitCode = 1;
});
