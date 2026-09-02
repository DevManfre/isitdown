import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error a plain .mjs tool, typed only by its own JSDoc
import { fixturePath, formatBody, recordFixture } from "../../tools/record-fixture.mjs";
import { withServer } from "../helpers/localServer.ts";

const tempRoot = (): string => mkdtempSync(join(tmpdir(), "isitdown-fixture-"));

test("a JSON body is stored pretty-printed so a diff on it stays readable", () => {
  const { text, extension } = formatBody('{"status":{"indicator":"none"}}', "application/json");
  assert.equal(extension, "json");
  assert.equal(text, '{\n  "status": {\n    "indicator": "none"\n  }\n}\n');
});

test("a non-JSON body is stored verbatim under the extension its type implies", () => {
  assert.deepEqual(formatBody("<html>up</html>", "text/html; charset=utf-8"), {
    text: "<html>up</html>",
    extension: "html",
  });
  assert.deepEqual(formatBody("ok", "text/plain"), { text: "ok", extension: "txt" });
  assert.equal(formatBody("<rss/>", "application/rss+xml").extension, "xml");
});

test("a body typed as JSON but not parseable is kept verbatim rather than lost", () => {
  assert.deepEqual(formatBody("<html>login</html>", "application/json"), {
    text: "<html>login</html>",
    extension: "txt",
  });
});

test("a fixture lands beside its provider's siblings", () => {
  assert.equal(
    fixturePath("/repo", "slack", "operational", "json"),
    join("/repo", "test", "fixtures", "slack", "operational.json"),
  );
});

test("recording writes the provider's answer under the fixture tree", async () => {
  const root = tempRoot();
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"status":"ok"}');
    },
    async (baseUrl) => {
      const written = await recordFixture({
        url: `${baseUrl}/api/status`,
        provider: "slack",
        name: "operational",
        root,
      });
      assert.equal(written, join(root, "test", "fixtures", "slack", "operational.json"));
      assert.equal(readFileSync(written, "utf8"), '{\n  "status": "ok"\n}\n');
    },
  );
});

test("a non-2xx answer is not recorded: a fixture of an error page is a trap", async () => {
  const root = tempRoot();
  await withServer(
    (_req, res) => {
      res.writeHead(503, { "content-type": "application/json" });
      res.end("{}");
    },
    async (baseUrl) => {
      await assert.rejects(
        recordFixture({ url: `${baseUrl}/api/status`, provider: "slack", name: "operational", root }),
        /503/,
      );
    },
  );
});

test("an existing fixture is kept unless the overwrite is asked for", async () => {
  const root = tempRoot();
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"status":"new"}');
    },
    async (baseUrl) => {
      const target = fixturePath(root, "slack", "operational", "json");
      const call = (force?: boolean): Promise<string> =>
        recordFixture({ url: `${baseUrl}/api/status`, provider: "slack", name: "operational", root, force });

      await call();
      writeFileSync(target, "hand-edited");

      await assert.rejects(call(), /--force/);
      assert.equal(readFileSync(target, "utf8"), "hand-edited");

      await call(true);
      assert.equal(readFileSync(target, "utf8"), '{\n  "status": "new"\n}\n');
    },
  );
});
