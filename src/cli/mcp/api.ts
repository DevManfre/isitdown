import type { z } from "zod";
import { HttpStatusError, InvalidResponseError } from "../watch/client.ts";
import { apiErrorSchema } from "./schema.ts";

export type Query = Record<string, string | number | undefined>;

/**
 * The MCP tools' only way to the network, and like `watch`'s client it has
 * nothing but `GET`: no tool can poll, mute or configure anything, by
 * construction rather than by discipline.
 */
export interface ReadApi {
  get<T extends z.ZodTypeAny>(path: string, query: Query, schema: T): Promise<z.infer<T>>;
}

export function createReadApi(baseUrl: string, token: string): ReadApi {
  const authHeaders: Record<string, string> = token === "" ? {} : { authorization: `Bearer ${token}` };

  return {
    async get(path, query, schema) {
      const url = new URL(path, baseUrl);
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
      }
      let response: Response;
      try {
        response = await fetch(url, { method: "GET", headers: { ...authHeaders, accept: "application/json" } });
      } catch (error) {
        // undici's own message is a bare "fetch failed"; the cause says why.
        const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
        throw new Error(`cannot reach ${baseUrl}: ${cause}`);
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch (error) {
        if (!response.ok) throw new HttpStatusError(response.status, `GET ${path} -> ${response.status}`);
        throw new InvalidResponseError(error instanceof Error ? error.message : String(error));
      }
      if (!response.ok) {
        // The API's own reason ("days must be one of 7, 30, 90") is what lets
        // an assistant correct its call, so it is passed on rather than a bare
        // status code.
        const body = apiErrorSchema.safeParse(json);
        const reason = body.success ? `: ${body.data.error.message}` : "";
        throw new HttpStatusError(response.status, `GET ${path} -> ${response.status}${reason}`);
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) throw new InvalidResponseError(`GET ${path}: ${parsed.error.message}`);
      return parsed.data;
    },
  };
}
