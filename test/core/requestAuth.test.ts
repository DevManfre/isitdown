import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fetchConditional, forgetProvider, resetValidators } from "../../src/core/http.ts";
import { authProblems, forgetToken } from "../../src/core/requestAuth.ts";
import { optionProblems } from "../../src/adapters/index.ts";
import { withServer } from "../helpers/localServer.ts";

const base = { providerId: "m365", accept: "application/json", timeoutMs: 2000, label: "json fetch" };

/** A source that records what each request carried and answers with `status`. */
function recordingSource(status: () => number = () => 200) {
  const seen: IncomingMessage["headers"][] = [];
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    seen.push(req.headers);
    res.writeHead(status(), { "content-type": "application/json" });
    res.end('{"status":"serviceOperational"}');
  };
  return { handler, seen };
}

/**
 * Both endpoints on one local server: `/token` is the identity provider, and
 * anything else is the source. The token endpoint issues `t1`, `t2`, … so a
 * test can tell a cached token from a fresh one.
 */
function oauthPair(sourceStatus: () => number = () => 200, expiresIn = 3600) {
  const tokenRequests: URLSearchParams[] = [];
  const sourceAuth: (string | undefined)[] = [];
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    if (req.url === "/token") {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        tokenRequests.push(new URLSearchParams(body));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: `t${tokenRequests.length}`, token_type: "Bearer", expires_in: expiresIn }));
      });
      return;
    }
    sourceAuth.push(req.headers.authorization);
    res.writeHead(sourceStatus(), { "content-type": "application/json" });
    res.end("{}");
  };
  return { handler, tokenRequests, sourceAuth };
}

function withEnv(vars: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const before = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  const set = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  set(vars);
  return run().finally(() => set(before));
}

function fresh(): void {
  resetValidators();
  forgetToken();
}

test("a provider with no credentials sends no authorization header", async () => {
  fresh();
  const source = recordingSource();
  await withServer(source.handler, async (url) => {
    await fetchConditional(url, { ...base, auth: { path: "/x" } });
  });
  assert.equal(source.seen[0]?.authorization, undefined);
});

test("header.<Name> is sent with ${VAR} resolved from the environment", async () => {
  fresh();
  const source = recordingSource();
  await withEnv({ ZENDESK_KEY: "s3cret" }, () =>
    withServer(source.handler, async (url) => {
      await fetchConditional(url, { ...base, auth: { "header.X-Api-Key": "key ${ZENDESK_KEY}" } });
    }),
  );
  assert.equal(source.seen[0]?.["x-api-key"], "key s3cret");
});

test("tokenEnv becomes a bearer token", async () => {
  fresh();
  const source = recordingSource();
  await withEnv({ MERAKI_TOKEN: "abc" }, () =>
    withServer(source.handler, async (url) => {
      await fetchConditional(url, { ...base, auth: { tokenEnv: "MERAKI_TOKEN" } });
    }),
  );
  assert.equal(source.seen[0]?.authorization, "Bearer abc");
});

test("an explicit header.Authorization has the last word over tokenEnv", async () => {
  fresh();
  const source = recordingSource();
  await withEnv({ MERAKI_TOKEN: "abc" }, () =>
    withServer(source.handler, async (url) => {
      await fetchConditional(url, {
        ...base,
        auth: { tokenEnv: "MERAKI_TOKEN", "header.Authorization": "Basic Zm9vOmJhcg==" },
      });
    }),
  );
  assert.equal(source.seen[0]?.authorization, "Basic Zm9vOmJhcg==");
});

test("an unset variable fails the read before anything is sent", async () => {
  fresh();
  const source = recordingSource();
  await withEnv({ MISSING_TOKEN: undefined }, () =>
    withServer(source.handler, async (url) => {
      await assert.rejects(
        fetchConditional(url, { ...base, auth: { tokenEnv: "MISSING_TOKEN" } }),
        /MISSING_TOKEN, which is not set/,
      );
    }),
  );
  assert.equal(source.seen.length, 0);
});

test("client credentials: the token is requested once and reused while it is valid", async () => {
  fresh();
  const pair = oauthPair();
  await withEnv({ M365_SECRET: "shh" }, () =>
    withServer(pair.handler, async (url) => {
      const auth = {
        oauthTokenUrl: `${url}/token`,
        oauthClientId: "app-1",
        oauthClientSecretEnv: "M365_SECRET",
        oauthScope: "https://graph.microsoft.com/.default",
      };
      await fetchConditional(`${url}/health`, { ...base, auth });
      await fetchConditional(`${url}/health`, { ...base, auth });
    }),
  );
  assert.equal(pair.tokenRequests.length, 1);
  const form = pair.tokenRequests[0] as URLSearchParams;
  assert.equal(form.get("grant_type"), "client_credentials");
  assert.equal(form.get("client_id"), "app-1");
  assert.equal(form.get("client_secret"), "shh");
  assert.equal(form.get("scope"), "https://graph.microsoft.com/.default");
  assert.deepEqual(pair.sourceAuth, ["Bearer t1", "Bearer t1"]);
});

test("client credentials: a token about to expire is renewed rather than sent", async () => {
  fresh();
  // Thirty seconds left is inside the renewal margin, so it is never reused.
  const pair = oauthPair(() => 200, 30);
  await withEnv({ M365_SECRET: "shh" }, () =>
    withServer(pair.handler, async (url) => {
      const auth = { oauthTokenUrl: `${url}/token`, oauthClientId: "app-1", oauthClientSecretEnv: "M365_SECRET" };
      await fetchConditional(`${url}/health`, { ...base, auth });
      await fetchConditional(`${url}/health`, { ...base, auth });
    }),
  );
  assert.deepEqual(pair.sourceAuth, ["Bearer t1", "Bearer t2"]);
});

test("client credentials: a 401 drops the token, so the next read asks for a new one", async () => {
  fresh();
  let status = 401;
  const pair = oauthPair(() => status);
  await withEnv({ M365_SECRET: "shh" }, () =>
    withServer(pair.handler, async (url) => {
      const auth = { oauthTokenUrl: `${url}/token`, oauthClientId: "app-1", oauthClientSecretEnv: "M365_SECRET" };
      await assert.rejects(fetchConditional(`${url}/health`, { ...base, auth }), /HTTP 401/);
      status = 200;
      await fetchConditional(`${url}/health`, { ...base, auth });
    }),
  );
  assert.deepEqual(pair.sourceAuth, ["Bearer t1", "Bearer t2"]);
});

test("client credentials: forgetting the provider forgets its token", async () => {
  fresh();
  const pair = oauthPair();
  await withEnv({ M365_SECRET: "shh" }, () =>
    withServer(pair.handler, async (url) => {
      const auth = { oauthTokenUrl: `${url}/token`, oauthClientId: "app-1", oauthClientSecretEnv: "M365_SECRET" };
      await fetchConditional(`${url}/health`, { ...base, auth });
      forgetProvider("m365");
      await fetchConditional(`${url}/health`, { ...base, auth });
    }),
  );
  assert.equal(pair.tokenRequests.length, 2);
});

test("client credentials: a refused token request names the identity provider's reason", async () => {
  fresh();
  const handler = (_req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(400, { "content-type": "application/json" });
    res.end('{"error":"invalid_client"}');
  };
  await withEnv({ M365_SECRET: "shh" }, () =>
    withServer(handler, async (url) => {
      const auth = { oauthTokenUrl: `${url}/token`, oauthClientId: "app-1", oauthClientSecretEnv: "M365_SECRET" };
      await assert.rejects(
        fetchConditional(`${url}/health`, { ...base, auth }),
        (error: Error) => /token request failed: HTTP 400.*invalid_client/.test(error.message) && !error.message.includes("shh"),
      );
    }),
  );
});

test("authProblems: no credentials and complete credentials are both fine", () => {
  assert.deepEqual(authProblems(undefined), []);
  assert.deepEqual(authProblems({ path: "/x" }), []);
  assert.deepEqual(authProblems({ tokenEnv: "TOKEN", "header.X-Tenant": "acme" }), []);
  assert.deepEqual(
    authProblems({ oauthTokenUrl: "https://login.example/token", oauthClientId: "a", oauthClientSecretEnv: "S" }),
    [],
  );
});

test("authProblems: refuses inline secrets, bad names and half an OAuth block", () => {
  const problems = (options: Record<string, string>) => authProblems(options).join("\n");
  assert.match(problems({ token: "abc" }), /token: never written here/);
  assert.match(problems({ oauthClientSecret: "abc" }), /oauthClientSecret: never written here/);
  assert.match(problems({ tokenEnv: "not a name" }), /not an environment variable name/);
  assert.match(problems({ oauthTokenUrl: "https://x/token" }), /go together/);
  assert.match(problems({ oauthScope: "s" }), /oauthScope means nothing/);
  assert.match(
    problems({ oauthTokenUrl: "ftp://x", oauthClientId: "a", oauthClientSecretEnv: "S" }),
    /not an http or https URL/,
  );
  assert.match(
    problems({ tokenEnv: "T", oauthTokenUrl: "https://x/t", oauthClientId: "a", oauthClientSecretEnv: "S" }),
    /keep one/,
  );
  assert.match(problems({ "header.": "x" }), /needs a header name/);
});

test("optionProblems checks credentials on a page adapter, not on a probe", () => {
  assert.match(optionProblems("statuspage", { token: "abc" }).join("\n"), /never written here/);
  assert.deepEqual(optionProblems("http", { token: "abc" }), []);
});
