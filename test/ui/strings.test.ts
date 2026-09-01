import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const WEB = new URL("../../src/ui/web/", import.meta.url).pathname;

/**
 * A heuristic, and knowingly weaker than the text-node scan it replaced: JSX
 * has no parse-free way to tell a translated expression from a literal. It
 * catches the common mistake — an English sentence typed straight into markup —
 * and nothing more. The i18n-strings skill remains the actual rule.
 */
// Every entry needs its own comment naming the real, non-catalog text it is
// letting past the two scans below — a set-level comment invites the next
// addition to go unjustified. Empty for now: this set used to carry
// "presentation", added for `role="presentation"` in UptimeRing.tsx, but
// neither scan can ever reach it — the attribute scan only matches
// aria-label/title/placeholder (role carries no reader-facing text). Removing
// it left every test below passing, confirming it was never live; deleted
// rather than kept as a placeholder that reads as a guard exception and isn't
// one.
const ALLOWED = new Set<string>([]);

// Assertions run against the code, not the prose that documents it. Block
// comments strip unconditionally. Line comments strip too — a `//` doc
// comment quoting real catalog copy for context (Overview.tsx does exactly
// this for its plural headline) is otherwise indistinguishable from a live
// literal — but only where the `//` is not itself part of a URL: a naive
// `//.*$` would also eat the `//` in `https://`. A `//` not preceded by `:`
// is never a URL's scheme separator, so that is the line this draws; the
// tradeoff is a URL split across a line in some way that puts a bare `//`
// right after a non-colon character would still be stripped, which is not a
// pattern this codebase uses.
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");

// components/ui/ is NOT exempt. It used to be, on the premise that
// "shadcn-generated primitives carry no copy" — which is simply untrue:
// stock `dialog.tsx` ships an English "Close" twice, once as the icon button's
// screen-reader label and once as the footer's optional button, and the
// default-on `showCloseButton` put the first of those in every dialog the
// dashboard renders. Nothing in the tree overrode it, so screen-reader users
// got English whatever the locale, and this guard was looking the other way.
// A generated file is exactly where unreviewed English arrives from, so it is
// the last directory that should be skipped. `node_modules` is skipped because
// Vitest's own cache lives under src/ui/web/node_modules.
async function filesUnder(dir: string, extensions: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      found.push(...(await filesUnder(path, extensions)));
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      found.push(path);
    }
  }
  return found;
}

test("no english copy is typed straight into JSX", async () => {
  const offenders: string[] = [];
  for (const file of await filesUnder(WEB, [".tsx"])) {
    if (file.endsWith(".test.tsx")) continue;
    const source = strip(readFileSync(file, "utf8"));
    // >One or more words of prose< between tags, with no {expression} in sight.
    // One, not two: the two-word minimum was the second reason dialog.tsx's
    // "Close" went unseen for the whole port — a single-word button label is
    // the most common literal there is, and every one of them is copy.
    for (const match of source.matchAll(/>\s*([A-Z][a-z]+(?: [a-z]+)*)\s*</g)) {
      const text = (match[1] as string).trim();
      if (!ALLOWED.has(text)) offenders.push(`${file}: "${text}"`);
    }
  }
  assert.deepEqual(offenders, [], "use t(\"key\") and add the key to both catalogs");
});

test("no user-facing attribute carries a literal", async () => {
  const offenders: string[] = [];
  for (const file of await filesUnder(WEB, [".tsx"])) {
    if (file.endsWith(".test.tsx")) continue;
    const source = strip(readFileSync(file, "utf8"));
    for (const match of source.matchAll(/(aria-label|title|placeholder)="([^"]{2,})"/g)) {
      const value = match[2] as string;
      if (!ALLOWED.has(value)) offenders.push(`${file}: ${match[1]}="${value}"`);
    }
  }
  assert.deepEqual(offenders, [], "these are read by an operator: use t(\"key\")");
});

test("no non-english word is hiding in a catalog-bypassing literal", async () => {
  const italian = /\b(provider(?:i)?|stato|impostazioni|cronologia|incidenti|aggiorna)\b/i;
  const offenders: string[] = [];
  for (const file of await filesUnder(WEB, [".tsx", ".ts"])) {
    if (file.endsWith(".test.tsx") || file.endsWith(".test.ts")) continue;
    for (const match of strip(readFileSync(file, "utf8")).matchAll(/"([^"\n]{4,})"/g)) {
      const value = match[1] as string;
      if (value.includes("/") || value.includes("-") || value.includes(".")) continue;
      if (italian.test(value) && !/^[a-z.]+$/.test(value)) offenders.push(`${file}: "${value}"`);
    }
  }
  assert.deepEqual(offenders, [], "English is the source language; it.json holds the Italian");
});
