#!/usr/bin/env node
// Complexity inventory (roadmap 16.1): what each subsystem costs, as numbers.
//
// "IsItDown has become too complex" stays an opinion until it has a figure, and
// every later decision about what to prune (16.3, 16.4) or what to add starts
// from this table. Five figures per subsystem:
//
//   - source and test lines (non-blank), counted separately;
//   - config.yml keys: leaf key paths of the Light schema, an array's items
//     counted once, attributed by concern — `services` to the adapters,
//     `notifications` to the notifiers, everything else to the core;
//   - environment variables the subsystem's own code reads (credentials named
//     through a `${VAR}` reference in config.yml are config keys, not these);
//   - Settings fields: form controls in the dashboard's settings surfaces;
//   - concepts an operator has to learn to use it — the hand-written list below;
//   - build and packaging targets it ships as.
//
// Deterministic for the same tree, and dateless on purpose: the date lives in
// the documentation that quotes it, so the output can be diffed in CI (16.5).
//
// CLI: node tools/complexity-inventory.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * The most keys the base path in `config.example.yml` may hold (roadmap 16.2).
 * Seven is what one catalog provider and one channel cost today — id, name,
 * adapter and baseUrl, then enabled and two credentials. Lower it only with a
 * change that removes one of them, never by moving a key out of the base path.
 */
export const BASE_PATH_CEILING = 7;

/**
 * What an operator has to understand to use each subsystem — one line per
 * concept, written by hand because no parser can tell a concept from a helper.
 * Add a line in the same commit as the feature that makes someone learn it.
 */
export const CONCEPTS = {
  core: [
    "provider (service) and its id",
    "poll cycle and interval",
    "per-provider cadence",
    "adaptive polling",
    "retries and the request timeout",
    "monitoring degraded (failure threshold)",
    "status severities (operational → major outage)",
    "transition: only changes notify",
    "flap damping (confirm samples)",
    "correlated outage",
    "provider group",
    "tags",
    "dependencies (dependsOn)",
    "mute and planned mutes",
    "declared maintenance",
    "routing rule",
    "quiet hours",
    "digest",
    "per-hour cap",
    "update in place",
    "maintenance notice",
    "escalation",
    "channel health",
    "incident summary message",
    "coalescing",
    "known outage",
    "periodic report",
    "on-call rotation",
    "recipient",
    "delivery test",
    "SLA target and error budget",
    "outage cost",
    "impact and owner",
    "runbook",
    "silent-outage cross-check",
    "source authority (declared / observed)",
    "outpost consensus",
    "heartbeat",
    "egress policy",
  ],
  adapters: [
    "adapter",
    "Statuspage-compatible page",
    "provider catalog",
    "adapter detection",
    "component scoping",
    "adapter options",
    "probe (http / tcp / dns / icmp / docker / sequence)",
    "scraping adapters (html / watchdog)",
    "mailbox adapter (imap)",
    "adapter plugin",
    "provider push instead of poll",
    "conditional requests",
  ],
  notifiers: [
    "notification channel",
    "credential as an environment-variable reference",
    "per-channel locale",
    "message template",
    "webhook signature",
    "chatops commands",
  ],
  light: ["config.yml, re-read every cycle", ".env file", "the check command", "JSON state file"],
  ui: [
    "runtime settings in SQLite",
    "secrets file",
    "API token",
    "public status page",
    "backups and config snapshots",
    "daily rollups and retention",
    "AI incident summaries",
    "operator metric series",
    "update check",
  ],
  dashboard: [
    "views and the rail",
    "command palette",
    "first-run wizard",
    "custom Overview dashboards and widgets",
    "starred providers",
    "wallboard",
    "themes and accent",
    "bulk edit",
    "delivery log",
    "why did I get this alert",
    "postmortem export",
  ],
  cli: ["isitdown watch", "isitdown discover", "isitdown import"],
  outpost: ["outpost", "outpost token"],
  packaging: ["edition (Light / UI)", "image tag", "compose profile", "data volume", "single binary (SEA)", "Helm chart", "Unraid template", "Home Assistant add-on"],
};

/**
 * Build and packaging targets, each pinned to the file that makes it so a
 * deleted one fails the inventory instead of quietly staying counted. The
 * images and binaries belong to the edition they ship; the deployment
 * descriptors around them to packaging.
 */
const TARGETS = {
  light: [
    { name: "light image", file: "Dockerfile", contains: "AS light" },
    { name: "single binary", file: "tools/build-sea.mjs" },
  ],
  ui: [{ name: "ui image", file: "Dockerfile", contains: "AS ui" }],
  cli: [{ name: "dist/cli build", file: "tsconfig.cli.json" }],
  packaging: [
    { name: "compose profile light", file: "docker-compose.yml", contains: 'profiles: ["light"]' },
    { name: "compose profile ui", file: "docker-compose.yml", contains: 'profiles: ["ui"]' },
    { name: "compose profile outpost", file: "docker-compose.yml", contains: 'profiles: ["outpost"]' },
    { name: "Helm chart", file: "deploy/helm/isitdown/Chart.yaml" },
    { name: "k8s manifest light", file: "deploy/k8s/light.yaml" },
    { name: "k8s manifest ui", file: "deploy/k8s/ui.yaml" },
    { name: "Unraid template light", file: "deploy/unraid/isitdown-light.xml" },
    { name: "Unraid template ui", file: "deploy/unraid/isitdown-ui.xml" },
    { name: "Home Assistant add-on", file: "deploy/homeassistant/isitdown/Dockerfile" },
  ],
};

/** Where each subsystem's code lives. A `*.test.*` / `*.itest.*` file anywhere counts as test. */
const SUBSYSTEMS = [
  { id: "core", label: "Core (poller, diff engine, scheduler)", source: ["src/core"], test: ["test/core"] },
  { id: "adapters", label: "Adapters", source: ["src/adapters"], test: ["test/adapters"] },
  { id: "notifiers", label: "Notifiers", source: ["src/notifiers"], test: ["test/notifiers"] },
  { id: "light", label: "Light edition", source: ["src/light"], test: ["test/light"] },
  { id: "ui", label: "UI server", source: ["src/ui"], exclude: ["src/ui/web"], test: ["test/ui"] },
  { id: "dashboard", label: "Dashboard", source: ["src/ui/web"], test: [] },
  { id: "cli", label: "CLI", source: ["src/cli"], test: ["test/cli"] },
  { id: "outpost", label: "Outpost", source: ["src/outpost"], test: ["test/outpost"] },
  {
    id: "packaging",
    label: "Packaging",
    source: ["Dockerfile", "docker-compose.yml", "docker-compose.dev.yml", "deploy", "tools/build-sea.mjs"],
    test: [],
    anyText: true,
  },
];

const CODE = /\.(ts|tsx|mjs|js|css)$/;
const TEST = /\.(test|itest)\.(ts|tsx|mjs)$/;
const SETTINGS_SURFACES = ["src/ui/web/views/Settings.tsx", "src/ui/web/components/settings", "src/ui/web/components/service-dialog"];
const FORM_CONTROL = /<(Input|Textarea|Switch|Select|Checkbox|ToggleGroup|RadioGroup|Slider|NumberSetting)\b/g;
const ENV_READ = /\benv(?:\.|\[["'])([A-Z][A-Z0-9_]+)/g;

/** Every file under `paths`, sorted, skipping node_modules and anything under `exclude`. */
function files(root, paths, exclude = []) {
  const out = [];
  const walk = (path) => {
    const rel = relative(root, path);
    if (rel.split("/").includes("node_modules") || exclude.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) return;
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) walk(join(path, name));
    } else {
      out.push(path);
    }
  };
  for (const path of paths) walk(join(root, path));
  return out;
}

const lines = (path) => readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "").length;

/** Leaf key paths of a zod schema, an array's element and a union's members folded into one path each. */
export function schemaKeyPaths(schema, prefix = "") {
  const def = schema._def;
  switch (def.typeName) {
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodCatch":
    case "ZodBranded":
    case "ZodReadonly":
      return schemaKeyPaths(def.innerType, prefix);
    case "ZodEffects":
      return schemaKeyPaths(def.schema, prefix);
    case "ZodPipeline":
      return schemaKeyPaths(def.in, prefix);
    case "ZodLazy":
      return schemaKeyPaths(def.getter(), prefix);
    case "ZodArray":
      return schemaKeyPaths(def.type, `${prefix}[]`);
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      return [...new Set(def.options.flatMap((option) => schemaKeyPaths(option, prefix)))].sort();
    case "ZodObject":
      return Object.entries(schema.shape).flatMap(([key, value]) => schemaKeyPaths(value, prefix ? `${prefix}.${key}` : key));
    default:
      return prefix ? [prefix] : [];
  }
}

/** Leaf key paths of a parsed YAML document, an array's items folded into one path. */
export function documentKeyPaths(value, prefix = "") {
  if (Array.isArray(value)) return [...new Set(value.flatMap((item) => documentKeyPaths(item, `${prefix}[]`)))].sort();
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => documentKeyPaths(child, prefix ? `${prefix}.${key}` : key));
  }
  return prefix ? [prefix] : [];
}

/**
 * The base path's keys: whatever `config.example.yml` sets outside a comment.
 * Everything advanced in that file is commented out under the base path, so
 * what the YAML parser sees *is* the base path.
 */
export const basePathKeys = (yamlText) => documentKeyPaths(parse(yamlText) ?? {});

/** The inventory's rows, one per subsystem plus a total, from the tree at `root`. */
export async function inventory(root = ROOT) {
  const { fileConfigSchema } = await import(new URL("../src/light/config/schema.ts", import.meta.url).href);
  const configKeys = { core: 0, adapters: 0, notifiers: 0 };
  for (const path of schemaKeyPaths(fileConfigSchema)) {
    if (path.startsWith("services")) configKeys.adapters += 1;
    else if (path.startsWith("notifications")) configKeys.notifiers += 1;
    else configKeys.core += 1;
  }

  const settingsFields = files(root, SETTINGS_SURFACES)
    .filter((path) => path.endsWith(".tsx") && !TEST.test(path))
    .reduce((sum, path) => sum + (readFileSync(path, "utf8").match(FORM_CONTROL)?.length ?? 0), 0);

  const rows = SUBSYSTEMS.map((subsystem) => {
    const sourceFiles = files(root, subsystem.source, subsystem.exclude).filter((path) => subsystem.anyText || CODE.test(path));
    const testFiles = files(root, subsystem.test).filter((path) => CODE.test(path));
    const env = new Set();
    for (const path of sourceFiles.filter((file) => CODE.test(file) && !TEST.test(file))) {
      for (const match of readFileSync(path, "utf8").matchAll(ENV_READ)) env.add(match[1]);
    }
    for (const target of TARGETS[subsystem.id] ?? []) {
      const text = readFileSync(join(root, target.file), "utf8");
      if (target.contains && !text.includes(target.contains)) throw new Error(`${target.name}: ${target.file} no longer contains ${target.contains}`);
    }
    return {
      label: subsystem.label,
      sourceLines: sourceFiles.filter((path) => !TEST.test(path)).reduce((sum, path) => sum + lines(path), 0),
      testLines: [...sourceFiles.filter((path) => TEST.test(path)), ...testFiles].reduce((sum, path) => sum + lines(path), 0),
      configKeys: configKeys[subsystem.id] ?? 0,
      envVars: env.size,
      settingsFields: subsystem.id === "dashboard" ? settingsFields : 0,
      concepts: CONCEPTS[subsystem.id].length,
      targets: (TARGETS[subsystem.id] ?? []).length,
    };
  });
  const total = { label: "**Total**" };
  for (const key of ["sourceLines", "testLines", "configKeys", "envVars", "settingsFields", "concepts", "targets"]) {
    total[key] = rows.reduce((sum, row) => sum + row[key], 0);
  }
  const basePath = basePathKeys(readFileSync(join(root, "config.example.yml"), "utf8")).length;
  return { rows: [...rows, total], basePath };
}

/** The inventory as Markdown. */
export function render({ rows, basePath }) {
  const cell = (value) => (value === 0 ? "—" : value.toLocaleString("en-US"));
  return [
    "| Subsystem | Source lines | Test lines | config.yml keys | Env vars | Settings fields | Concepts | Build targets |",
    "|---|--:|--:|--:|--:|--:|--:|--:|",
    ...rows.map((row) =>
      `| ${row.label} | ${cell(row.sourceLines)} | ${cell(row.testLines)} | ${cell(row.configKeys)} | ${cell(row.envVars)} | ${cell(row.settingsFields)} | ${cell(row.concepts)} | ${cell(row.targets)} |`,
    ),
    "",
    `Base path (\`config.example.yml\`, Light): ${basePath} keys, ceiling ${BASE_PATH_CEILING}.`,
  ].join("\n");
}

if (process.argv[1]?.endsWith("complexity-inventory.mjs")) {
  process.stdout.write(`${render(await inventory())}\n`);
}
