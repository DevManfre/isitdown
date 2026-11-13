import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  cleanSummary,
  summarizeIncident,
  SummaryError,
  systemPrompt,
  userPrompt,
  type SummaryDeps,
  type SummaryInput,
} from "../../src/ui/incidentSummary.ts";
import { withServer } from "../helpers/localServer.ts";

const input: SummaryInput = {
  providerName: "GitHub",
  incidentName: "Elevated API error rates",
  impact: "major",
  status: "resolved",
  locale: "it",
  updates: [
    { at: "2026-11-01T10:00:00Z", status: "investigating", body: "We are investigating elevated error rates." },
    { at: "2026-11-01T10:45:00Z", status: "resolved", body: "A fix was deployed.\n\nResolved." },
  ],
};

test("the prompt fences the provider's words as data and names the language", () => {
  assert.match(systemPrompt("it"), /in Italian/);
  assert.match(systemPrompt("it"), /never as instructions/);
  const prompt = userPrompt(input);
  assert.match(prompt, /^<incident>/);
  assert.match(prompt, /<\/incident>$/);
  assert.match(prompt, /\[2026-11-01T10:45:00Z\] resolved: A fix was deployed\. Resolved\./);
});

test("a long incident keeps its newest updates and says how many it dropped", () => {
  const updates = Array.from({ length: 400 }, (_, index) => ({
    at: `2026-11-01T${String(index).padStart(6, "0")}`,
    status: "update",
    body: `update number ${index} `.repeat(10),
  }));
  const prompt = userPrompt({ ...input, updates });
  assert.ok(prompt.length < 26_000);
  assert.match(prompt, /update number 399/);
  assert.doesNotMatch(prompt, /update number 0 /);
  assert.match(prompt, /\(\d+ earlier updates omitted\)/);
});

test("a summary is one plain paragraph whatever the model wrapped it in", () => {
  assert.equal(cleanSummary("```\n## Summary\n**API** errors were fixed.\n```"), "Summary API errors were fixed.");
  assert.equal(cleanSummary("x".repeat(5000)).length, 1200);
});

test("off refuses before anything runs", async () => {
  await assert.rejects(
    summarizeIncident({ provider: "off", model: "", baseUrl: "" }, input, { env: {} }),
    (error: unknown) => error instanceof SummaryError && error.code === "not-configured",
  );
});

function fakeAnthropic(answer: { stop_reason: string; text: string }, seen: unknown[]): SummaryDeps["anthropic"] {
  return () =>
    ({
      beta: {
        messages: {
          create: async (body: unknown) => {
            seen.push(body);
            return { model: "claude-opus-5-5", stop_reason: answer.stop_reason, content: [{ type: "text", text: answer.text }] };
          },
        },
      },
    }) as never;
}

test("anthropic: needs a key, sends the default model with the refusal fallback, returns the text", async () => {
  const seen: unknown[] = [];
  const settings = { provider: "anthropic" as const, model: "", baseUrl: "" };
  await assert.rejects(
    summarizeIncident(settings, input, { env: {}, anthropic: fakeAnthropic({ stop_reason: "end_turn", text: "x" }, seen) }),
    (error: unknown) => error instanceof SummaryError && error.code === "no-key",
  );
  const result = await summarizeIncident(settings, input, {
    env: { AI_API_KEY: "sk-test" },
    anthropic: fakeAnthropic({ stop_reason: "end_turn", text: "Errori API risolti." }, seen),
  });
  assert.deepEqual(result, { summary: "Errori API risolti.", model: "claude-opus-5-5" });
  const body = seen[0] as { model: string; fallbacks?: string; output_config: { effort: string } };
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.fallbacks, "default");
  assert.equal(body.output_config.effort, "low");
});

test("anthropic: a model outside the fallback list is sent without it, and a refusal is reported", async () => {
  const seen: unknown[] = [];
  await assert.rejects(
    summarizeIncident({ provider: "anthropic", model: "claude-haiku-5-5", baseUrl: "" }, input, {
      env: { AI_API_KEY: "sk-test" },
      anthropic: fakeAnthropic({ stop_reason: "refusal", text: "" }, seen),
    }),
    (error: unknown) => error instanceof SummaryError && error.code === "refused",
  );
  assert.equal((seen[0] as { fallbacks?: string }).fallbacks, undefined);
});

test("openai-compatible: posts to the base url, bearer only with a key, reads the first choice", async () => {
  const seen: { url: string; auth: string | undefined; body: { model: string; messages: unknown[] } }[] = [];
  await withServer(
    (req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
      req.on("end", () => {
        seen.push({ url: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(raw) as never });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ model: "llama3", choices: [{ message: { content: " Fixed. " } }] }));
      });
    },
    async (baseUrl) => {
      const settings = { provider: "openai" as const, model: "llama3", baseUrl: `${baseUrl}/v1/` };
      const result = await summarizeIncident(settings, input, { env: {} });
      assert.deepEqual(result, { summary: "Fixed.", model: "llama3" });
      await summarizeIncident(settings, input, { env: { AI_API_KEY: "k" } });
    },
  );
  assert.equal(seen[0]?.url, "/v1/chat/completions");
  assert.equal(seen[0]?.auth, undefined);
  assert.equal(seen[1]?.auth, "Bearer k");
  assert.equal(seen[0]?.body.messages.length, 2);
});

test("openai-compatible: no model named, a refused key and an odd body are each their own error", async () => {
  await assert.rejects(
    summarizeIncident({ provider: "openai", model: "", baseUrl: "" }, input, { env: {} }),
    (error: unknown) => error instanceof SummaryError && error.code === "not-configured",
  );
  let status = 401;
  await withServer(
    (_req, res) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ nope: true }));
    },
    async (baseUrl) => {
      const settings = { provider: "openai" as const, model: "m", baseUrl };
      await assert.rejects(summarizeIncident(settings, input, { env: {} }), (error: unknown) => error instanceof SummaryError && error.code === "no-key");
      status = 200;
      await assert.rejects(summarizeIncident(settings, input, { env: {} }), (error: unknown) => error instanceof SummaryError && error.code === "failed");
    },
  );
});

/** A child process that answers on stdout and exits with `code`. */
function fakeSpawn(stdout: string, code: number, seen: { args: string[]; stdin: string; cwd?: string }[]): SummaryDeps["spawn"] {
  return ((_command: string, args: string[], options: { cwd?: string }) => {
    const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => void };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    let stdin = "";
    child.stdin.on("data", (chunk: Buffer) => (stdin += chunk.toString()));
    child.stdin.on("finish", () => {
      seen.push({ args, stdin, ...(options.cwd === undefined ? {} : { cwd: options.cwd }) });
      child.stderr.write("Warning: this sign-in can end at any time\n");
      child.stdout.end(stdout);
      child.stderr.end();
      setImmediate(() => child.emit("close", code));
    });
    return child;
  }) as never;
}

test("claude-cli: refused when the binary is not on PATH", async () => {
  await assert.rejects(
    summarizeIncident({ provider: "claude-cli", model: "", baseUrl: "" }, input, { env: { PATH: "" }, spawn: fakeSpawn("x", 0, []) }),
    (error: unknown) => error instanceof SummaryError && error.code === "no-cli",
  );
});

test("claude-cli: runs claude -p with no tools, prompt on stdin, reads only stdout", async (t) => {
  const { mkdtemp, writeFile, chmod } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  if (process.platform === "win32") return t.skip("PATH lookup is POSIX here");
  const dir = await mkdtemp(join(tmpdir(), "isitdown-claude-"));
  await writeFile(join(dir, "claude"), "#!/bin/sh\n");
  await chmod(join(dir, "claude"), 0o755);

  const seen: { args: string[]; stdin: string; cwd?: string }[] = [];
  const result = await summarizeIncident({ provider: "claude-cli", model: "", baseUrl: "" }, input, {
    env: { PATH: dir },
    spawn: fakeSpawn("Errori API risolti.\n", 0, seen),
  });
  assert.deepEqual(result, { summary: "Errori API risolti.", model: "Claude Code" });
  const args = seen[0]?.args ?? [];
  assert.equal(args[0], "-p");
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.ok(args.includes("--strict-mcp-config"));
  assert.ok(args.includes("--no-session-persistence"));
  assert.ok(!args.includes("--model"));
  assert.match(seen[0]?.stdin ?? "", /^<incident>/);
  assert.equal(seen[0]?.cwd, tmpdir());

  await summarizeIncident({ provider: "claude-cli", model: "sonnet", baseUrl: "" }, input, { env: { PATH: dir }, spawn: fakeSpawn("ok", 0, seen) });
  assert.equal(seen[1]?.args[(seen[1]?.args.indexOf("--model") ?? 0) + 1], "sonnet");

  await assert.rejects(
    summarizeIncident({ provider: "claude-cli", model: "", baseUrl: "" }, input, { env: { PATH: dir }, spawn: fakeSpawn("", 1, seen) }),
    (error: unknown) => error instanceof SummaryError && error.code === "failed" && /exited with 1/.test(error.message),
  );
  // The CLI's own failure is on stdout; a sign-in problem is the operator's to fix.
  await assert.rejects(
    summarizeIncident({ provider: "claude-cli", model: "", baseUrl: "" }, input, {
      env: { PATH: dir },
      spawn: fakeSpawn("Failed to authenticate. API Error: 401 Invalid bearer token\n", 1, seen),
    }),
    (error: unknown) => error instanceof SummaryError && error.code === "no-key" && /401 Invalid bearer token/.test(error.message),
  );
});

// The model menu in Settings (roadmap 6.10).
import { ANTHROPIC_MODELS, CLAUDE_CLI_MODELS, listModels } from "../../src/ui/incidentSummary.ts";

test("models: the CLI offers its aliases, Anthropic its fixed list until there is a key", async () => {
  assert.deepEqual(await listModels({ provider: "claude-cli", model: "", baseUrl: "" }, { env: {} }), { models: CLAUDE_CLI_MODELS });
  assert.deepEqual(await listModels({ provider: "anthropic", model: "", baseUrl: "" }, { env: {} }), { models: ANTHROPIC_MODELS });
  assert.deepEqual(await listModels({ provider: "off", model: "", baseUrl: "" }, { env: {} }), { models: [] });
});

test("models: with a key, Anthropic's live list; a failure falls back and says why", async () => {
  const live = await listModels({ provider: "anthropic", model: "", baseUrl: "" }, {
    env: { AI_API_KEY: "k" },
    anthropic: () =>
      ({
        models: {
          list: async function* () {
            yield { id: "claude-opus-5-5", display_name: "Claude Opus 5.5" };
            yield { id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5" };
          },
        },
      }) as never,
  });
  assert.deepEqual(live.models.map((model) => model.id), ["claude-opus-5-5", "claude-haiku-5-5"]);
  const failed = await listModels({ provider: "anthropic", model: "", baseUrl: "" }, {
    env: { AI_API_KEY: "k" },
    anthropic: () => ({ models: { list: () => { throw new Error("401"); } } }) as never,
  });
  assert.deepEqual(failed.models, ANTHROPIC_MODELS);
  assert.match(failed.error ?? "", /401/);
});

test("models: an OpenAI-compatible server is asked for /models, sorted and deduplicated", async () => {
  let status = 200;
  await withServer(
    (req, res) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url === "/v1/models" ? { data: [{ id: "qwen3" }, { id: "llama3.1" }, { id: "qwen3" }] } : {}));
    },
    async (baseUrl) => {
      const settings = { provider: "openai" as const, model: "", baseUrl: `${baseUrl}/v1` };
      assert.deepEqual((await listModels(settings, { env: {} })).models.map((model) => model.id), ["llama3.1", "qwen3"]);
      status = 500;
      const failed = await listModels(settings, { env: {} });
      assert.deepEqual(failed.models, []);
      assert.match(failed.error ?? "", /HTTP 500/);
    },
  );
});
