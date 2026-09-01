import { afterEach, describe, expect, it, vi } from "vitest";
import { getStatus } from "./api.ts";

type FakeResponse = { ok: boolean; status: number; text: () => Promise<string> };

function stubFetch(response: FakeResponse): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request", () => {
  it("surfaces the server's own error.message when the failure body is JSON", async () => {
    stubFetch({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { message: "provider unknown: github" } }),
    });
    await expect(getStatus()).rejects.toThrow("provider unknown: github");
  });

  it("falls back to the HTTP status, not a raw SyntaxError, when a failure body isn't JSON", async () => {
    stubFetch({
      ok: false,
      status: 502,
      text: async () => "<html>Bad Gateway</html>",
    });
    await expect(getStatus()).rejects.toThrow("HTTP 502");
  });

  it("does not turn a 200 with a non-JSON body into an error", async () => {
    stubFetch({
      ok: true,
      status: 200,
      text: async () => "not json",
    });
    await expect(getStatus()).resolves.toBeUndefined();
  });
});
