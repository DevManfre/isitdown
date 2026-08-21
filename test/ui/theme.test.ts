import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const PUBLIC = new URL("../../src/ui/public/", import.meta.url).pathname;
const TOKENS = join(PUBLIC, "css/tokens.css");

async function filesUnder(dir: string, extensions: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(path, extensions)));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(path);
  }
  return found;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Byte offset of one CSS block's real rule, by its selector (which must
 * include the trailing " {").
 *
 * A plain `css.indexOf(selector)` also matches this file's own header
 * comment, which quotes ':root[data-theme="dark"]' in prose describing the
 * palette's structure, on a line that happens to start with exactly that
 * text. `indexOf` lands on the prose, then the caller's own `indexOf("{", …)`
 * walks forward to the *next* "{" in the file — which belongs to a
 * different block entirely (in practice, the light block), so a selector
 * without its brace silently resolves to the wrong rule. Requiring the
 * selector's own opening brace, anchored to the start of a line, rules the
 * prose out: that comment line is never followed immediately by "{".
 */
function blockStart(css: string, selector: string): number {
  const pattern = new RegExp(`^\\s*${escapeRegExp(selector)}`, "m");
  const match = pattern.exec(css);
  assert.ok(match, `tokens.css has no ${selector} block`);
  return (match as RegExpExecArray).index;
}

/** Custom properties declared inside one CSS block, by its selector. */
function declaredIn(css: string, selector: string): string[] {
  const open = css.indexOf("{", blockStart(css, selector));
  const close = css.indexOf("}", open);
  return [...css.slice(open, close).matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1] as string).sort();
}

test("only tokens.css contains a hex colour", async () => {
  const offenders: string[] = [];
  for (const file of await filesUnder(join(PUBLIC, "css"), [".css"])) {
    if (file === TOKENS) continue;
    const hexes = readFileSync(file, "utf8").match(/#[0-9a-fA-F]{3,8}\b/g);
    if (hexes !== null) offenders.push(`${file}: ${[...new Set(hexes)].join(", ")}`);
  }
  assert.deepEqual(offenders, [], "every colour outside the token file must be a var()");
});

test("no hex colour is hardcoded in the dashboard markup or scripts", async () => {
  const offenders: string[] = [];
  for (const file of await filesUnder(PUBLIC, [".js", ".html"])) {
    const hexes = readFileSync(file, "utf8").match(/#[0-9a-fA-F]{6}\b/g);
    if (hexes !== null) offenders.push(`${file}: ${[...new Set(hexes)].join(", ")}`);
  }
  assert.deepEqual(offenders, []);
});

test("the light and dark palettes declare exactly the same tokens", () => {
  const css = readFileSync(TOKENS, "utf8");
  const light = declaredIn(css, ":root {");
  const dark = declaredIn(css, ':root[data-theme="dark"] {');
  const system = declaredIn(css, ':root:not([data-theme="light"]) {');

  assert.ok(light.length > 20, `expected a full palette, got ${light.length} tokens`);
  assert.deepEqual(dark, light, "a token defined in one theme but not the other renders wrong");
  assert.deepEqual(system, dark, "the system block must mirror the explicit dark block");
});

test("every status in the severity model has its own colour token in both themes", () => {
  const css = readFileSync(TOKENS, "utf8");
  const required = [
    "--status-operational",
    "--status-degraded",
    "--status-partial-outage",
    "--status-major-outage",
    "--status-unknown",
  ];
  for (const selector of [":root {", ':root[data-theme="dark"] {', ':root:not([data-theme="light"]) {']) {
    const declared = declaredIn(css, selector);
    for (const token of required) {
      assert.ok(declared.includes(token), `${selector} is missing ${token}`);
    }
  }
});

test("every custom property the dashboard references is declared in tokens.css", async () => {
  const css = readFileSync(TOKENS, "utf8");
  const declared = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1] as string));
  const missing = new Set<string>();

  for (const file of await filesUnder(PUBLIC, [".css", ".js", ".html"])) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/var\((--[\w-]+)/g)) {
      const name = match[1] as string;
      if (!declared.has(name)) missing.add(`${name} (in ${file})`);
    }
  }
  assert.deepEqual([...missing], []);
});

test("the page sets its theme before first paint", () => {
  const html = readFileSync(join(PUBLIC, "index.html"), "utf8");
  const head = html.slice(0, html.indexOf("</head>"));
  assert.match(head, /data-theme/, "an inline head script must stamp data-theme to avoid a flash");
  assert.ok(head.includes("<script"), "the theme script has to run in the head, not at the end of the body");
  assert.ok(
    head.indexOf("<script") < head.indexOf('<link rel="stylesheet"'),
    "the theme must be stamped before any stylesheet can paint",
  );
});

test("the dashboard declares no user-facing text outside a catalog", () => {
  const html = readFileSync(join(PUBLIC, "index.html"), "utf8");
  // Text nodes that are not whitespace and not inside a script/style block.
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const textNodes = [...stripped.matchAll(/>([^<>]+)</g)]
    .map((match) => (match[1] as string).trim())
    .filter((text) => text.length > 0);
  assert.deepEqual(textNodes, [], `untranslated text in index.html: ${textNodes.join(" | ")}`);
});
