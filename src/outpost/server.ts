import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Adapter, ReadingNote } from "../core/adapter.interface.ts";
import type { Logger } from "../core/logger.ts";
import { outpostRequestSchema, type OutpostResponse } from "../core/outpost.ts";

/** A probe request is a few hundred bytes; anything far past that is not one. */
const MAX_BODY_BYTES = 64 * 1024;

export interface OutpostServerDeps {
  token: string;
  getAdapter: (id: string) => Adapter;
  logger: Logger;
}

/**
 * The outpost — roadmap 1.7 — as a server: one route that runs one probe and
 * answers with what it found, and a health route for the container runtime.
 *
 * Stateless on purpose. It keeps no configuration, no history and no schedule:
 * the poller sends the whole probe with every request, so the same container
 * serves any number of installations and a restart loses nothing.
 *
 * Probes only. A status page reads the same from anywhere in the world, so a
 * second vantage point on one buys nothing — and refusing every other adapter
 * keeps this from being a general-purpose fetcher for whoever holds the token.
 * Node's own `http` rather than Express: two routes do not earn a framework.
 */
export function createOutpostServer(deps: OutpostServerDeps): Server {
  const { token, getAdapter, logger } = deps;
  const expected = Buffer.from(`Bearer ${token}`);

  return createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      logger.error("outpost request crashed", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) send(res, 500, { error: "internal error" });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "GET" && req.url === "/health") {
      send(res, 200, { ok: true });
      return;
    }
    if (req.url !== "/probe") {
      send(res, 404, { error: "not found" });
      return;
    }
    if (req.method !== "POST") {
      send(res, 405, { error: "method not allowed" });
      return;
    }
    const given = Buffer.from(req.headers.authorization ?? "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      send(res, 401, { error: "missing or wrong bearer token" });
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (error) {
      send(res, 400, { error: error instanceof Error ? error.message : "body is not JSON" });
      return;
    }
    const parsed = outpostRequestSchema.safeParse(body);
    if (!parsed.success) {
      send(res, 400, { error: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") });
      return;
    }
    const request = parsed.data;

    let adapter: Adapter;
    try {
      adapter = getAdapter(request.adapter);
    } catch {
      send(res, 400, { error: `unknown adapter "${request.adapter}"` });
      return;
    }
    if (adapter.kind !== "probe") {
      send(res, 400, { error: `"${request.adapter}" reads a status page; an outpost only runs probes` });
      return;
    }

    let note: ReadingNote | undefined;
    try {
      const status = await adapter.fetchStatus(request.service, {
        timeoutMs: request.timeoutMs,
        onNote: (reported) => {
          note = reported;
        },
      });
      const answer: OutpostResponse = {
        status,
        ...(note === undefined
          ? {}
          : { note: { text: note.text, ...(note.unreachable === true ? { unreachable: true } : {}) } }),
      };
      logger.debug("probe answered", { providerId: request.service.id, status: status.overallStatus });
      send(res, 200, answer);
    } catch (error) {
      // A probe that throws read nothing at all — a bad option, most likely.
      // Not a 200: the poller must count this outpost as silent, not as "down".
      send(res, 502, { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
