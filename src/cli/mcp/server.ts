import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { ToolInputError, type Tool, type ToolContext } from "./tools.ts";

/**
 * The Model Context Protocol over stdio, written by hand (roadmap 7.1). The
 * issue asked to measure before pulling in the SDK: a read-only server with
 * no resources, no prompts and no sampling needs four methods — `initialize`,
 * `ping`, `tools/list`, `tools/call` — over newline-delimited JSON-RPC 2.0,
 * which is this file. The SDK would have been a runtime dependency (and its
 * own transitive ones) carried by every CLI build for the same four methods.
 */

/** Newest first; `initialize` answers with the client's version when it is one of these, the newest otherwise. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** The tool surface's own version: bumped when a tool's arguments or answer change shape. */
export const SERVER_INFO = { name: "isitdown", version: "1.0.0" };

const INSTRUCTIONS =
  "Read-only access to an IsItDown instance: the status of the third-party providers it watches, their history and incidents, and the operator's deploy markers. Use status_at to check what a provider was going through at a given moment.";

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

type JsonRpcId = string | number | null;

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string };
}

function errorResponse(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Answers one incoming line. `null` for a notification, which by JSON-RPC
 * gets no answer at all — `notifications/initialized` and
 * `notifications/cancelled` are the ones a client sends.
 */
export async function handleMessage(
  line: string,
  tools: readonly Tool[],
  context: ToolContext,
): Promise<JsonRpcResponse | null> {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return errorResponse(null, PARSE_ERROR, "parse error");
  }
  if (!isRecord(message) || message["jsonrpc"] !== "2.0" || typeof message["method"] !== "string") {
    const id = isRecord(message) && (typeof message["id"] === "string" || typeof message["id"] === "number") ? message["id"] : null;
    return errorResponse(id, INVALID_REQUEST, "invalid request");
  }
  if (!("id" in message)) return null;
  const id = message["id"] as JsonRpcId;
  const params = isRecord(message["params"]) ? message["params"] : {};

  switch (message["method"]) {
    case "initialize": {
      const asked = params["protocolVersion"];
      const protocolVersion = (PROTOCOL_VERSIONS as readonly unknown[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: tools.map(({ name, title, description, inputSchema }) => ({
            name,
            title,
            description,
            inputSchema,
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
          })),
        },
      };
    case "tools/call": {
      const tool = tools.find((entry) => entry.name === params["name"]);
      if (tool === undefined) return errorResponse(id, INVALID_PARAMS, `unknown tool: ${String(params["name"])}`);
      try {
        const answer = await tool.run(params["arguments"], context);
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(answer) }], isError: false } };
      } catch (error) {
        // A tool's failure — bad arguments, an unreachable instance, a 4xx
        // from the API — is the tool's answer, not a protocol error: the
        // model reads it and can try again differently.
        const reason = error instanceof Error ? error.message : String(error);
        const text = error instanceof ToolInputError ? `invalid arguments: ${reason}` : reason;
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: true } };
      }
    }
    default:
      return errorResponse(id, METHOD_NOT_FOUND, `method not found: ${message["method"]}`);
  }
}

/**
 * Serves until `input` ends — which is how an MCP client stops a stdio
 * server: it closes the pipe. Calls are answered as they finish rather than
 * in order, which JSON-RPC allows and the `id` on every answer makes safe.
 * Nothing but protocol ever goes to `output`.
 */
export async function serveMcp(
  input: Readable,
  output: Writable,
  tools: readonly Tool[],
  context: ToolContext,
): Promise<void> {
  const pending = new Set<Promise<void>>();
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of lines) {
    if (line.trim() === "") continue;
    const task = handleMessage(line, tools, context).then((response) => {
      if (response !== null) output.write(`${JSON.stringify(response)}\n`);
    });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }
  await Promise.all(pending);
}
