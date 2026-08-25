import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const WEB = new URL("../../src/ui/web/", import.meta.url).pathname;
const TOKENS = join(WEB, "css/tokens.css");

async function filesUnder(dir: string, extensions: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "ui") continue; // shadcn-generated primitives, not our design tokens
      found.push(...(await filesUnder(path, extensions)));
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      found.push(path);
    }
  }
  return found;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Assertions run against the code, not the prose that documents it. Block
// comments only: stripping `//` too would also have to dodge the `//` inside
// an `https://` URL, and nothing under src/ui/web currently hides a violation
// behind a line comment, so the simpler, narrower rule is chosen deliberately
// — a `//` comment can still trip a scan below.
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

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
  return [...strip(css.slice(open, close)).matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1] as string).sort();
}

test("only tokens.css contains a hex colour", async () => {
  const offenders: string[] = [];
  for (const file of await filesUnder(join(WEB, "css"), [".css"])) {
    if (file === TOKENS) continue;
    const hexes = strip(readFileSync(file, "utf8")).match(/#[0-9a-fA-F]{3,8}\b/g);
    if (hexes !== null) offenders.push(`${file}: ${[...new Set(hexes)].join(", ")}`);
  }
  assert.deepEqual(offenders, [], "every colour outside the token file must be a var()");
});

test("no hex colour is hardcoded in the dashboard markup or scripts", async () => {
  const offenders: string[] = [];
  for (const file of await filesUnder(WEB, [".ts", ".tsx", ".html"])) {
    const hexes = strip(readFileSync(file, "utf8")).match(/#[0-9a-fA-F]{6}\b/g);
    if (hexes !== null) offenders.push(`${file}: ${[...new Set(hexes)].join(", ")}`);
  }
  assert.deepEqual(offenders, []);
});

test("no Tailwind arbitrary value smuggles in a hex colour", async () => {
  const offenders: string[] = [];
  for (const file of await filesUnder(WEB, [".ts", ".tsx"])) {
    const hits = readFileSync(file, "utf8").match(/\[[^\]]*#[0-9a-fA-F]{3,8}[^\]]*\]/g);
    if (hits !== null) offenders.push(`${file}: ${[...new Set(hits)].join(", ")}`);
  }
  assert.deepEqual(offenders, [], "a colour in a utility class is still a colour outside the token file");
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

// A "does every shadcn semantic token exist in every theme block" case
// used to live here too, checking the same 20 tokens across the same three
// selectors. Deleted rather than kept once its selector-brace bug (see
// blockStart's own doc comment) was fixed: src/ui/web/css/tokens.test.ts's
// "declares every semantic token in every theme block" already asserts the
// identical presence check against the identical token list, and goes
// further — it also asserts the three blocks declare exactly the same
// token set, and that each one resolves to a palette var(), never a
// literal. A second, weaker copy of that check, hand-rolled with its own
// declaredIn/blockStart pair, is exactly the kind of duplicate that drifts
// out of sync with the real one (as this file's brace bug just did) rather
// than adding coverage.

test("every custom property the dashboard references is declared in tokens.css", async () => {
  const css = readFileSync(TOKENS, "utf8");
  const declared = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1] as string));
  const missing = new Set<string>();

  for (const file of await filesUnder(WEB, [".css", ".ts", ".tsx", ".html"])) {
    const source = strip(readFileSync(file, "utf8"));
    for (const match of source.matchAll(/var\((--[\w-]+)/g)) {
      const name = match[1] as string;
      if (!declared.has(name)) missing.add(`${name} (in ${file})`);
    }
  }
  assert.deepEqual([...missing], []);
});

test("the page sets its theme before first paint", () => {
  const html = readFileSync(join(WEB, "index.html"), "utf8");
  const head = html.slice(0, html.indexOf("</head>"));
  assert.match(head, /data-theme/, "an inline head script must stamp data-theme to avoid a flash");
  assert.ok(head.includes("<script"), "the theme script has to run in the head, not at the end of the body");
  // A long href wraps the attributes onto their own lines, so the tag is not
  // one contiguous "<link rel=..." substring — match the attribute itself.
  const stylesheetIndex = head.search(/<link[^>]*rel="stylesheet"/);
  assert.ok(stylesheetIndex !== -1, "expected a stylesheet link in the head");
  assert.ok(
    head.indexOf("<script") < stylesheetIndex,
    "the theme must be stamped before any stylesheet can paint",
  );
});
