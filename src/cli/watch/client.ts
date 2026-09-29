import { readSse } from "./sse.ts";
import {
  cycleEventSchema,
  helloEventSchema,
  statusResponseSchema,
  type CycleEvent,
  type HelloEvent,
  type StatusResponse,
} from "./schema.ts";

/** A non-2xx HTTP response, carrying the status so callers can special-case 401/403. */
export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

/** The response body was not the JSON shape `schema.ts` expects. */
export class InvalidResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidResponseError";
  }
}

export type StreamEvent = { type: "hello"; data: HelloEvent } | { type: "cycle"; data: CycleEvent };

/**
 * A read-only client for the two endpoints the watch view needs — GET
 * `/status` and GET `/events`. Every request is a `GET`: this client has no
 * method to call `/poll` or anything else that writes, by construction
 * rather than by discipline, which is what "sola lettura" (roadmap 17.7)
 * means for the one piece of code that talks to the network.
 */
export interface ApiClient {
  fetchStatus(signal?: AbortSignal): Promise<StatusResponse>;
  openEventStream(onEvent: (event: StreamEvent) => void, signal: AbortSignal): Promise<void>;
}

export function createApiClient(baseUrl: string, token: string): ApiClient {
  const authHeaders: Record<string, string> = token === "" ? {} : { authorization: `Bearer ${token}` };

  async function get(path: string, accept: string, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(new URL(path, baseUrl), {
        method: "GET",
        headers: { ...authHeaders, accept },
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) {
      throw new HttpStatusError(response.status, `GET ${path} -> ${response.status}`);
    }
    return response;
  }

  return {
    async fetchStatus(signal) {
      const response = await get("/status", "application/json", signal);
      let json: unknown;
      try {
        json = await response.json();
      } catch (error) {
        throw new InvalidResponseError(error instanceof Error ? error.message : String(error));
      }
      const parsed = statusResponseSchema.safeParse(json);
      if (!parsed.success) throw new InvalidResponseError(parsed.error.message);
      return parsed.data;
    },

    async openEventStream(onEvent, signal) {
      const response = await get("/events", "text/event-stream", signal);
      await readSse(
        response,
        (frame) => {
          if (frame.type === "hello") {
            const parsed = helloEventSchema.safeParse(JSON.parse(frame.data));
            if (parsed.success) onEvent({ type: "hello", data: parsed.data });
          } else if (frame.type === "cycle") {
            const parsed = cycleEventSchema.safeParse(JSON.parse(frame.data));
            if (parsed.success) onEvent({ type: "cycle", data: parsed.data });
          }
        },
        signal,
      );
    },
  };
}
