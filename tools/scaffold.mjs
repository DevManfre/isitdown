#!/usr/bin/env node
// Scaffolding for a human contributor (roadmap 13.8): a new adapter or a new
// notification channel, laid out the way the `add-status-adapter` and
// `add-notifier-channel` skills lay one out for Claude. Those skills point
// here, so there is one recipe and two ways to run it.
//
//   npm run new:adapter -- <id>
//   npm run new:notifier -- <id>
//
// What it writes compiles, and what it cannot know — the provider's endpoint,
// the channel's settings — is left as an explicit failure, never a guess: the
// generated code throws "not implemented", and the generated tests fail on
// that until somebody implements it. What only the author can fill in is
// printed as a checklist at the end.
//
// CLI: node tools/scaffold.mjs <adapter|notifier> <id> [--root <dir>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["en", "de", "es", "fr", "it", "pt"];

/** Lower-case words joined by hyphens, starting with a letter — the shape every existing id has. */
const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const words = (id) => id.split("-");
const pascal = (id) => words(id).map((word) => word[0].toUpperCase() + word.slice(1)).join("");
const camel = (id) => pascal(id)[0].toLowerCase() + pascal(id).slice(1);
const title = (id) => words(id).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
/** An object key as the registries write it: bare when it can be, quoted when it has a hyphen. */
const key = (id) => (/^[a-z][a-z0-9]*$/.test(id) ? id : JSON.stringify(id));

/** The lines between `opener` and the `};` that closes it, with `line` added last. */
export function insertInBlock(text, opener, line) {
  const lines = text.split("\n");
  const start = lines.findIndex((candidate) => candidate.startsWith(opener));
  if (start === -1) throw new Error(`no block opening with "${opener}"`);
  const end = lines.findIndex((candidate, index) => index > start && candidate === "};");
  if (end === -1) throw new Error(`the block "${opener}" is never closed`);
  lines.splice(end, 0, line);
  return lines.join("\n");
}

/** `line` right after the last line matching `pattern`. */
export function insertAfterLast(text, pattern, line) {
  const lines = text.split("\n");
  const at = lines.findLastIndex((candidate) => pattern.test(candidate));
  if (at === -1) throw new Error(`no line matches ${pattern}`);
  lines.splice(at + 1, 0, line);
  return lines.join("\n");
}

/** `row` as the last row of the Markdown table that has a row matching `anchor`. */
export function appendToTable(text, anchor, row) {
  const lines = text.split("\n");
  let at = lines.findIndex((candidate) => candidate.startsWith("|") && anchor.test(candidate));
  if (at === -1) throw new Error(`no table row matches ${anchor}`);
  while (lines[at + 1]?.startsWith("|")) at += 1;
  lines.splice(at + 1, 0, row);
  return lines.join("\n");
}

/** A key added last to a flat JSON catalog, keeping its two-space, one-key-per-line layout. */
export function addCatalogKey(text, name, value) {
  const lines = text.trimEnd().split("\n");
  if (lines.at(-1) !== "}") throw new Error("a catalog must end with a closing brace on its own line");
  if (name in JSON.parse(text)) throw new Error(`the catalog already has "${name}"`);
  lines[lines.length - 2] += ",";
  lines.splice(lines.length - 1, 0, `  ${JSON.stringify(name)}: ${JSON.stringify(value)}`);
  return `${lines.join("\n")}\n`;
}

const adapterSource = (id) => `import type { Adapter, FetchContext, ServiceRef } from "../core/adapter.interface.ts";
import type { NormalizedStatus } from "../core/types.ts";

/**
 * ${title(id)} — TODO: which page this reads (its URL and endpoint), and how
 * its own words map onto operational / degraded / partial_outage /
 * major_outage / unknown. When a word does not map cleanly, the more severe
 * bucket: an outage must never read as operational.
 */

/**
 * The pure mapping from the provider's answer, exported so the fixture tests
 * need no network. Validate the body with zod first (never trust its shape),
 * throw when it is not this provider's payload at all, and degrade — never
 * throw — when a single optional field is missing.
 */
export function parse${pascal(id)}(raw: unknown, service: ServiceRef): NormalizedStatus {
  throw new Error(\`${id} adapter: parse${pascal(id)} is not implemented yet (\${service.id}, \${typeof raw} body)\`);
}

export const ${camel(id)}Adapter: Adapter = {
  id: "${id}",

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    // TODO: the provider's status endpoint.
    const response = await fetch(\`\${service.baseUrl}/TODO\`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(\`${id} fetch for \${service.id} failed: HTTP \${response.status}\`);
    }
    return parse${pascal(id)}(await response.json(), service);
  },
};
`;

const adapterTest = (id) => `import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ${camel(id)}Adapter, parse${pascal(id)} } from "../../src/adapters/${id}.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = { id: "${id}", name: "${title(id)}", baseUrl: "https://status.example.com" };
// operational.json is a placeholder: replace it with the provider's real answer,
//   npm run record-fixture -- <status endpoint URL> ${id} operational --force
// and record "incident" and "resolved" the same way while the page shows them.
const fixture = (name: string): string => readFileSync(new URL(\`../fixtures/${id}/\${name}.json\`, import.meta.url), "utf8");

runAdapterContract("${id}", () => ({
  adapter: ${camel(id)}Adapter,
  service: (baseUrl) => ({ ...service, baseUrl }),
  // TODO: the endpoint fetchStatus reads, as a path.
  ok: { "/TODO": fixture("operational") },
  // The same endpoint with every optional field stripped.
  degraded: { "/TODO": JSON.stringify({}) },
}));

test("the recorded page reads operational with no incident", () => {
  const read = parse${pascal(id)}(JSON.parse(fixture("operational")), service);
  assert.equal(read.overallStatus, "operational");
  assert.deepEqual(read.activeIncidents, []);
});
`;

const notifierSource = (id) => `import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { renderParts } from "./formatting.ts";

/**
 * TODO: every setting the channel needs. Each one arrives from an environment
 * variable (see src/ui/db/seed.ts and src/light/config/schema.ts), never from a
 * value written into config.yml; \`httpUrlSetting\` in ./settings.ts validates a
 * URL the way every other channel does.
 */
const settingsSchema = z.object({});

/**
 * ${title(id)} — TODO: what the channel is, which API it posts to, and anything
 * about its format a reader would not guess (rate limits, size caps, how a
 * credential travels).
 *
 * The message is built from \`renderParts\`, as every channel's is, so the
 * severity vocabulary, the locale and the operator's template stay shared.
 */
export function create${pascal(id)}Notifier(settings: Record<string, string>): Notifier {
  settingsSchema.parse(settings);

  return {
    id: "${id}",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);
      // TODO: post it — \`fetch\` with \`signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)\`
      // and, on a non-2xx, \`throw httpFailure("${id}", "failed", response.status, …)\`
      // (both from ./errors.ts), so a refusal names the channel and never a secret.
      throw new Error(\`${id} notifier is not implemented yet: "\${heading}" (\${detail}) \${url}\`);
    },
  };
}
`;

const notifierTest = (id) => `import { test } from "node:test";
import assert from "node:assert/strict";
import { create${pascal(id)}Notifier } from "../../src/notifiers/${id}.notifier.ts";
import { stubFetch } from "../helpers/fetchStub.ts";
import type { NotificationPayload } from "../../src/core/types.ts";

// TODO: the channel's settings, with obviously fake credentials.
const settings = {};

const opened: NotificationPayload = {
  change: {
    kind: "incident_opened",
    providerId: "github",
    currentStatus: "major_outage",
    incident: {
      id: "i1",
      name: "API requests failing",
      impact: "major",
      status: "investigating",
      updatedAt: "2026-08-19T14:32:07.000Z",
    },
    at: "2026-08-19T14:32:07.000Z",
  },
  service: { id: "github", name: "GitHub", statusUrl: "https://www.githubstatus.com" },
  locale: "en",
};

test("an opened incident is delivered in one request that names the provider and the incident", async () => {
  const stub = stubFetch(() => new Response("{}", { status: 200 }));
  try {
    await create${pascal(id)}Notifier(settings).send(opened);
  } finally {
    stub.restore();
  }

  assert.equal(stub.requests.length, 1);
  const [request] = stub.requests;
  assert.match(request?.rawBody ?? "", /GitHub/);
  assert.match(request?.rawBody ?? "", /API requests failing/);
});
`;

/** Every file the new piece needs, created, and every registry it joins, edited — or nothing at all. */
export function scaffold(kind, id, root = ROOT) {
  if (kind !== "adapter" && kind !== "notifier") throw new Error(`unknown kind "${kind}": adapter or notifier`);
  if (!ID.test(id)) throw new Error(`"${id}" is not an id: lower-case letters and digits, words joined by "-"`);

  const created = new Map();
  const edited = new Map();
  const read = (path) => edited.get(path) ?? readFileSync(join(root, path), "utf8");
  const edit = (path, change) => edited.set(path, change(read(path)));

  if (kind === "adapter") {
    created.set(`src/adapters/${id}.adapter.ts`, adapterSource(id));
    created.set(`test/adapters/${id}.test.ts`, adapterTest(id));
    created.set(
      `test/fixtures/${id}/operational.json`,
      `${JSON.stringify({ _placeholder: `replace with a recorded answer: npm run record-fixture -- <url> ${id} operational --force` }, null, 2)}\n`,
    );
    edit("src/adapters/index.ts", (text) =>
      insertInBlock(
        insertAfterLast(text, /^import \{ \w+ \} from "\.\/[\w-]+\.adapter\.ts";$/, `import { ${camel(id)}Adapter } from "./${id}.adapter.ts";`),
        "export const adapters: Record<string, Adapter> = {",
        `  [${camel(id)}Adapter.id]: ${camel(id)}Adapter,`,
      ),
    );
    edit("docs/configuration.md", (text) => appendToTable(text, /^\| `cstate` \|/, `| \`${id}\` | TODO | TODO | TODO |`));
    edit("docs/configuration.it.md", (text) => appendToTable(text, /^\| `cstate` \|/, `| \`${id}\` | TODO | TODO | TODO |`));
  } else {
    created.set(`src/notifiers/${id}.notifier.ts`, notifierSource(id));
    created.set(`test/notifiers/${id}.test.ts`, notifierTest(id));
    edit("src/notifiers/index.ts", (text) =>
      insertInBlock(
        insertAfterLast(text, /^import \{ \w+ \} from "\.\/[\w-]+\.notifier\.ts";$/, `import { create${pascal(id)}Notifier } from "./${id}.notifier.ts";`),
        "const factories: Record<string, NotifierFactory> = {",
        `  ${key(id)}: create${pascal(id)}Notifier,`,
      ),
    );
    edit("src/ui/web/components/settings/ChannelRow.tsx", (text) =>
      insertInBlock(text, "export const CHANNEL_NAME_KEYS: Record<string, string> = {", `  ${key(id)}: "channel.name.${id}",`),
    );
    for (const locale of LOCALES) {
      edit(`src/ui/web/locales/${locale}.json`, (text) => addCatalogKey(text, `channel.name.${id}`, title(id)));
    }
    edit("docs/configuration.md", (text) => appendToTable(text, /\| `zulip` \|/, `| ${title(id)} | \`${id}\` | TODO |`));
    edit("docs/configuration.it.md", (text) => appendToTable(text, /\| `zulip` \|/, `| ${title(id)} | \`${id}\` | TODO |`));
  }

  // Checked before anything is written, so a refusal leaves the tree as it was.
  for (const path of created.keys()) {
    if (existsSync(join(root, path))) throw new Error(`${path} already exists — pick another id or remove it first`);
  }
  for (const [path, text] of created) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  for (const [path, text] of edited) writeFileSync(join(root, path), text);

  return { created: [...created.keys()], edited: [...edited.keys()], todo: kind === "adapter" ? adapterTodo(id) : notifierTodo(id) };
}

const adapterTodo = (id) => [
  `Implement parse${pascal(id)} and the endpoint in src/adapters/${id}.adapter.ts`,
  `Record real fixtures: npm run record-fixture -- <url> ${id} operational --force (then incident, resolved)`,
  `Fill the endpoint into test/adapters/${id}.test.ts, then add this provider's own mapping tests`,
  `Describe it: the TODO row in docs/configuration.md and docs/configuration.it.md (plus a paragraph if it needs one)`,
  `To offer it in the dashboard's add dialog: src/ui/web/components/service-dialog/SourceStep.tsx and AdapterOptions.tsx, with adapter.hint.${id} and add.note.${id} in every catalog`,
];

const notifierTodo = (id) => [
  `Implement the settings and send() in src/notifiers/${id}.notifier.ts`,
  `Fill the settings into test/notifiers/${id}.test.ts, and test a resolved transition too`,
  `Add a contract case to test/notifiers/contract/cases.ts (the contract suite fails until there is one), then UPDATE_GOLDEN=1 node --test test/notifiers/contract.test.ts and review the golden file`,
  `Light edition: a schema, a REQUIRED_CHANNEL_SETTINGS entry and a channels entry in src/light/config/schema.ts`,
  `UI edition: a channel row in src/ui/db/seed.ts (and its id in test/ui/migrate.test.ts)`,
  `Env vars in .env.example, a disabled example in config.example.yml, the variables in the TODO cell of docs/configuration.md and docs/configuration.it.md`,
  `Check channel.name.${id} in de, es, fr, it and pt: each holds the English "${title(id)}" until translated`,
];

if (process.argv[1]?.endsWith("scaffold.mjs")) {
  const [kind, id] = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  const rootFlag = process.argv.indexOf("--root");
  try {
    const result = scaffold(kind, id, rootFlag === -1 ? ROOT : resolve(process.argv[rootFlag + 1]));
    for (const path of result.created) process.stdout.write(`created  ${path}\n`);
    for (const path of result.edited) process.stdout.write(`edited   ${path}\n`);
    process.stdout.write(`\nThe generated tests fail until it is implemented. Still to do:\n`);
    for (const item of result.todo) process.stdout.write(`  - ${item}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write("usage: npm run new:adapter -- <id>  |  npm run new:notifier -- <id>\n");
    process.exit(1);
  }
}
