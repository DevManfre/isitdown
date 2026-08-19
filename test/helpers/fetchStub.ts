export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FetchStub {
  requests: CapturedRequest[];
  restore(): void;
}

/**
 * Replaces global fetch for the duration of a test. Notifier tests must never
 * reach a real third-party API, and stubbing at this level still exercises the
 * notifier's own serialisation and error handling.
 */
export function stubFetch(respond: (request: CapturedRequest) => Response): FetchStub {
  const original = globalThis.fetch;
  const requests: CapturedRequest[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const raw = typeof init?.body === "string" ? init.body : undefined;
    const request: CapturedRequest = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: raw === undefined ? undefined : (JSON.parse(raw) as unknown),
    };
    requests.push(request);
    return respond(request);
  }) as typeof globalThis.fetch;

  return {
    requests,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
