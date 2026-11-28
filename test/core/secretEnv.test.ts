import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySecretFiles, readSecretEnv, SECRET_ENV_VARS, SecretEnvError } from "../../src/core/secretEnv.ts";

function secretFile(content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "isitdown-secret-")), "secret");
  writeFileSync(path, content);
  return path;
}

test("only the variable: its value, untouched", () => {
  assert.equal(readSecretEnv("API_TOKEN", { API_TOKEN: "abc\n" }), "abc\n");
  assert.equal(readSecretEnv("API_TOKEN", {}), undefined);
});

test("only the file: its content, without the trailing newline", () => {
  assert.equal(readSecretEnv("API_TOKEN", { API_TOKEN_FILE: secretFile("abc\n") }), "abc");
  assert.equal(readSecretEnv("API_TOKEN", { API_TOKEN_FILE: secretFile("abc\r\n") }), "abc");
  assert.equal(readSecretEnv("API_TOKEN", { API_TOKEN_FILE: secretFile("abc") }), "abc");
  // Only one: a value that really ends in a blank line keeps it.
  assert.equal(readSecretEnv("API_TOKEN", { API_TOKEN_FILE: secretFile("abc\n\n") }), "abc\n");
});

test("both set is an error naming both variables", () => {
  assert.throws(
    () => readSecretEnv("API_TOKEN", { API_TOKEN: "abc", API_TOKEN_FILE: secretFile("abc") }),
    (error: unknown) =>
      error instanceof SecretEnvError && /API_TOKEN and API_TOKEN_FILE/.test(error.message),
  );
});

test("a missing file is an error naming the variable, the path and the reason", () => {
  assert.throws(
    () => readSecretEnv("API_TOKEN", { API_TOKEN_FILE: "/run/secrets/nope" }),
    (error: unknown) =>
      error instanceof SecretEnvError &&
      error.message.includes("API_TOKEN_FILE") &&
      error.message.includes("/run/secrets/nope") &&
      error.message.includes("ENOENT"),
  );
});

test("LOG_FILE is never read back as a secret called LOG", () => {
  const log = secretFile("a log line\n");
  assert.equal(readSecretEnv("LOG", { LOG_FILE: log }), undefined);
});

test("applySecretFiles turns NAME_FILE into NAME and drops the _FILE variable", () => {
  const env: Record<string, string | undefined> = {
    TELEGRAM_BOT_TOKEN_FILE: secretFile("123:abc\n"),
    WEBHOOK_URL: "https://example.com/hook",
  };
  applySecretFiles(env);
  assert.equal(env["TELEGRAM_BOT_TOKEN"], "123:abc");
  assert.equal(env["TELEGRAM_BOT_TOKEN_FILE"], undefined);
  assert.equal(env["WEBHOOK_URL"], "https://example.com/hook");
  // Resolved once: a later lookup sees one source, not two.
  assert.equal(readSecretEnv("TELEGRAM_BOT_TOKEN", env), "123:abc");
});

test("applySecretFiles reports every problem at once", () => {
  const env = {
    API_TOKEN: "a",
    API_TOKEN_FILE: secretFile("a"),
    PUSH_TOKEN_FILE: "/run/secrets/missing",
  };
  assert.throws(
    () => applySecretFiles(env),
    (error: unknown) =>
      error instanceof SecretEnvError && error.message.includes("API_TOKEN_FILE") && error.message.includes("PUSH_TOKEN_FILE"),
  );
});

test("every known secret goes through the helper", () => {
  const env: Record<string, string | undefined> = {};
  for (const name of SECRET_ENV_VARS) env[`${name}_FILE`] = `/secrets/${name}`;
  applySecretFiles(env, SECRET_ENV_VARS, (path) => `value of ${path}\n`);
  for (const name of SECRET_ENV_VARS) {
    assert.equal(env[name], `value of /secrets/${name}`, name);
    assert.equal(env[`${name}_FILE`], undefined, name);
  }
});

test("the configuration manual marks exactly the known secrets as accepting _FILE", () => {
  for (const page of ["docs/configuration.md", "docs/configuration.it.md"]) {
    const marked = new Set<string>();
    const unmarked = new Set<string>();
    const lines = readFileSync(page, "utf8").split("\n");
    const header = lines.findIndex((line) => /^\| (Variable|Variabile) \| .* \| `_FILE` \|/.test(line));
    assert.ok(header >= 0, `${page}: no variables table with a _FILE column`);
    for (const line of lines.slice(header + 2)) {
      if (!line.startsWith("|")) break;
      // Variable | Editions | _FILE | Default | Purpose
      const cells = line.split("|").map((cell) => cell.trim());
      const names = [...cells[1]!.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((match) => match[1]!);
      for (const name of names) (cells[3] === "✓" ? marked : unmarked).add(name);
    }
    assert.ok(marked.size + unmarked.size > 50, `${page}: the variables table was not found`);
    const known = new Set<string>(SECRET_ENV_VARS);
    const documented = [...known].filter((name) => marked.has(name) || unmarked.has(name));
    assert.deepEqual(
      [...marked].filter((name) => !known.has(name)),
      [],
      `${page}: marked ✓ but not in SECRET_ENV_VARS`,
    );
    assert.deepEqual(
      documented.filter((name) => !marked.has(name)),
      [],
      `${page}: a known secret without ✓`,
    );
  }
});
