import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStateStore } from "../../src/light/fileStateStore.ts";
import { runStateStoreContract } from "../core/stateStore.contract.ts";

async function tempPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "statuswatch-file-"));
  return join(dir, "state.json");
}

runStateStoreContract("fileStateStore", async () => {
  const path = await tempPath();
  return {
    store: await createFileStateStore(path),
    reopen: () => createFileStateStore(path),
  };
});

test("a missing file is an empty store rather than an error", async () => {
  const store = await createFileStateStore(await tempPath());
  assert.equal((await store.getState("github")).last, null);
  await store.close();
});

test("the parent directory is created when it does not exist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "statuswatch-file-"));
  const path = join(dir, "nested", "deeper", "state.json");
  const store = await createFileStateStore(path);
  await store.recordFailure("github");
  await store.close();
  assert.match(await readFile(path, "utf8"), /github/);
});

test("no temporary file is left behind after a write", async () => {
  const path = await tempPath();
  const store = await createFileStateStore(path);
  await store.recordFailure("github");
  await store.close();
  const entries = await readdir(join(path, ".."));
  assert.deepEqual(entries, ["state.json"]);
});

test("the file is human-readable JSON carrying its version", async () => {
  const path = await tempPath();
  const store = await createFileStateStore(path);
  await store.saveStatus({
    provider: "github",
    overallStatus: "degraded",
    activeIncidents: [],
    fetchedAt: "2026-08-19T14:05:00.000Z",
  });
  await store.close();
  const parsed = JSON.parse(await readFile(path, "utf8")) as { version: number; providers: unknown };
  assert.equal(parsed.version, 1);
  assert.ok(parsed.providers);
});

test("a file from an unknown future version is fatal rather than silently reset", async () => {
  const path = await tempPath();
  await writeFile(path, JSON.stringify({ version: 99, providers: {} }));
  await assert.rejects(createFileStateStore(path), /version/);
});

test("a structurally broken file is fatal rather than silently reset", async () => {
  const path = await tempPath();
  await writeFile(path, JSON.stringify({ version: 1, providers: { github: { last: "nope" } } }));
  await assert.rejects(createFileStateStore(path), /state file/);
});

test("unparseable JSON is fatal and names the file", async () => {
  const path = await tempPath();
  await writeFile(path, "{not json");
  await assert.rejects(createFileStateStore(path), new RegExp(path.replace(/[/\\]/g, "."))); 
});

test("concurrent mutations from a whole poll cycle all land and leave no temp file", async () => {
  const path = await tempPath();
  const store = await createFileStateStore(path);
  const providers = ["github", "cloudflare", "anthropic", "npm", "aws"];

  await Promise.all(
    providers.map((provider, index) =>
      index % 2 === 0
        ? store.saveStatus({
            provider,
            overallStatus: "degraded",
            activeIncidents: [],
            fetchedAt: "2026-08-19T14:05:00.000Z",
          })
        : store.recordFailure(provider),
    ),
  );
  await store.close();

  const parsed = JSON.parse(await readFile(path, "utf8")) as {
    providers: Record<string, { last: unknown; failureCount: number }>;
  };
  assert.deepEqual(Object.keys(parsed.providers).sort(), [...providers].sort());
  assert.ok(parsed.providers["github"]?.last, "an even provider kept its saved status");
  assert.equal(parsed.providers["cloudflare"]?.failureCount, 1);
  assert.deepEqual(await readdir(join(path, "..")), ["state.json"]);
});
