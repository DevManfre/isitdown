import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { ArgsError } from "../../src/cli/watch/args.ts";
import { createReadApi } from "../../src/cli/mcp/api.ts";
import { parseStatusArgs, type StatusArgs } from "../../src/cli/status/args.ts";
import { EXIT, runStatus } from "../../src/cli/status/run.ts";

/**
 * Roadmap 12.2: `isitdown status` against a fake UI edition — just `/status`,
 * shaped the way `src/ui/routes/status.routes.ts` answers it — through the real
 * HTTP client, so every exit code is the one a script would see.
 */

type Status = "operational" | "degraded" | "partial_outage" | "major_outage" | "unknown";

function provider(id: string, overallStatus: Status, enabled = true) {
  return { id, name: id.toUpperCase(), enabled, overallStatus, fetchedAt: "2026-11-27T10:00:00.000Z", extra: 1 };
}

interface Fake {
  url: string;
  authorizations: (string | undefined)[];
  close(): Promise<void>;
}

function fakeInstance(answer: { status?: number; body: unknown }): Promise<Fake> {
  const authorizations: (string | undefined)[] = [];
  return new Promise((resolve) => {
    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
      authorizations.push(req.headers.authorization);
      if (req.url !== "/status" || req.method !== "GET") {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(answer.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(answer.body));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        authorizations,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

/** A loopback URL whose port was just freed, so the connection is refused. */
async function closedPort(): Promise<string> {
  const probe = await fakeInstance({ body: null });
  await probe.close();
  return probe.url;
}

function fleet(...providers: ReturnType<typeof provider>[]) {
  return { body: { providers, serverNow: "2026-11-27T10:00:05.000Z" } };
}

async function run(
  answer: { status?: number; body: unknown } | null,
  options: Partial<StatusArgs> = {},
): Promise<{ code: number; out: string; err: string; fake: Fake | null }> {
  const fake = answer === null ? null : await fakeInstance(answer);
  const url = fake?.url ?? (await closedPort());
  const args: StatusArgs = { url, token: "", providers: [], json: false, exitCode: true, ...options };
  let out = "";
  let err = "";
  try {
    const code = await runStatus(args, {
      api: createReadApi(url, args.token),
      out: (text) => (out += text),
      err: (text) => (err += text),
    });
    return { code, out, err, fake };
  } finally {
    await fake?.close();
  }
}

test("--exit-code: 0 when every provider is operational", async () => {
  const { code, out } = await run(fleet(provider("github", "operational"), provider("stripe", "operational")));
  assert.equal(code, EXIT.OPERATIONAL);
  assert.equal(out, "all 2 providers operational\n");
});

test("--exit-code: 1 when something is degraded, a partial outage or unknown", async () => {
  for (const status of ["degraded", "partial_outage", "unknown"] as const) {
    const { code } = await run(fleet(provider("github", "operational"), provider("stripe", status)));
    assert.equal(code, EXIT.DEGRADED, status);
  }
});

test("--exit-code: 2 when something is down, even beside a degraded one", async () => {
  const { code, out } = await run(
    fleet(provider("github", "degraded"), provider("stripe", "major_outage"), provider("slack", "operational")),
  );
  assert.equal(code, EXIT.DOWN);
  // One line per provider not operational, nothing for the healthy one.
  assert.equal(out, "GITHUB (github): Degraded\nSTRIPE (stripe): Major outage\n");
});

test("--exit-code: 3 when the instance cannot be reached", async () => {
  const { code, out, err } = await run(null);
  assert.equal(code, EXIT.UNREACHABLE);
  assert.equal(out, "");
  assert.match(err, /cannot read the fleet: cannot reach http:\/\/127\.0\.0\.1:\d+: .*ECONNREFUSED/);
});

test("3 when the instance rejects the token, or answers with the wrong shape", async () => {
  const rejected = await run({ status: 401, body: { error: { message: "unauthorized" } } });
  assert.equal(rejected.code, EXIT.UNREACHABLE);
  assert.match(rejected.err, /401/);

  const garbled = await run({ body: { providers: "nope" } });
  assert.equal(garbled.code, EXIT.UNREACHABLE);
});

test("without --exit-code the fleet's state does not change the exit code", async () => {
  const { code } = await run(fleet(provider("stripe", "major_outage")), { exitCode: false });
  assert.equal(code, EXIT.OPERATIONAL);
  const unreachable = await run(null, { exitCode: false });
  assert.equal(unreachable.code, EXIT.UNREACHABLE);
});

test("--provider keeps only the named providers, for the output and the exit code", async () => {
  const answer = fleet(provider("github", "operational"), provider("stripe", "major_outage"));
  const { code, out } = await run(answer, { providers: ["github"] });
  assert.equal(code, EXIT.OPERATIONAL);
  assert.equal(out, "all 1 providers operational\n");
});

test("--provider naming a provider the instance does not monitor fails outside 0–3", async () => {
  const { code, err } = await run(fleet(provider("github", "operational"), provider("old", "operational", false)), {
    providers: ["github", "gitlab", "old"],
  });
  assert.equal(code, EXIT.USAGE);
  assert.match(err, /gitlab, old/);
});

test("disabled providers are left out", async () => {
  const { code } = await run(fleet(provider("github", "operational"), provider("old", "major_outage", false)));
  assert.equal(code, EXIT.OPERATIONAL);
});

test("--json prints the documented shape and nothing else", async () => {
  const { out } = await run(fleet(provider("github", "partial_outage"), provider("stripe", "operational")), {
    json: true,
  });
  assert.deepEqual(JSON.parse(out), {
    overall: "degraded",
    serverNow: "2026-11-27T10:00:05.000Z",
    providers: [
      { id: "github", name: "GITHUB", status: "partial_outage", fetchedAt: "2026-11-27T10:00:00.000Z" },
      { id: "stripe", name: "STRIPE", status: "operational", fetchedAt: "2026-11-27T10:00:00.000Z" },
    ],
  });
});

test("the token travels as a bearer", async () => {
  const fake = await fakeInstance(fleet(provider("github", "operational")));
  try {
    await runStatus(
      { url: fake.url, token: "s3cret", providers: [], json: false, exitCode: true },
      { api: createReadApi(fake.url, "s3cret"), out: () => {}, err: () => {} },
    );
    assert.deepEqual(fake.authorizations, ["Bearer s3cret"]);
  } finally {
    await fake.close();
  }
});

test("args: ISITDOWN_URL and ISITDOWN_TOKEN from the environment, API_TOKEN as fallback", () => {
  const fromEnv = parseStatusArgs([], { ISITDOWN_URL: "http://nas:3000", ISITDOWN_TOKEN: "a", API_TOKEN: "b" });
  assert.equal(fromEnv.url, "http://nas:3000");
  assert.equal(fromEnv.token, "a");
  assert.equal(parseStatusArgs([], { API_TOKEN: "b" }).token, "b");
  assert.equal(parseStatusArgs([], {}).url, "http://localhost:3000");
});

test("args: flags win over the environment; --provider splits and repeats", () => {
  const args = parseStatusArgs(
    ["--url", "http://x:1", "--token", "t", "--provider", "github, cloudflare", "--provider", "stripe", "--json", "--exit-code"],
    { ISITDOWN_URL: "http://nas:3000", ISITDOWN_TOKEN: "a" },
  );
  assert.deepEqual(args, {
    url: "http://x:1",
    token: "t",
    providers: ["github", "cloudflare", "stripe"],
    json: true,
    exitCode: true,
  });
});

test("args: an unknown option, a missing value or a bad URL is an ArgsError", () => {
  assert.throws(() => parseStatusArgs(["--quiet"], {}), ArgsError);
  assert.throws(() => parseStatusArgs(["--provider"], {}), ArgsError);
  assert.throws(() => parseStatusArgs(["--url", "not a url"], {}), ArgsError);
});
