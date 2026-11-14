import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse, removeKeys, scanSource } from "../../tools/i18n-orphans.mjs";

const usageOf = (...sources: string[]) => {
  const literals = new Set<string>();
  const patterns: RegExp[] = [];
  for (const source of sources) {
    const scanned = scanSource(source);
    for (const literal of scanned.literals) literals.add(literal);
    patterns.push(...scanned.patterns);
  }
  return { literals, patterns };
};

test("a key named by t() or by a constant handed to t() is used, one nothing names is an orphan", () => {
  const usage = usageOf(`t("nav.overview"); const ROUTES = [{ labelKey: 'nav.history' }];`);
  const { orphans } = analyse(["nav.overview", "nav.history", "nav.retired"], usage, []);
  assert.deepEqual(orphans, ["nav.retired"]);
});

test("a template literal uses every key it could build, and only those", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan
  const usage = usageOf("t(`theme.${mode}`)");
  const { orphans } = analyse(["theme.dark", "theme.light", "themes.dark"], usage, []);
  assert.deepEqual(orphans, ["themes.dark"]);
});

test("a template that opens on an interpolation hides nothing", () => {
  // `${a}.${b}` would match every dotted key and silence the whole report.
  // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan
  const usage = usageOf("const sort = `${first.id}.${dir}`;");
  const { orphans } = analyse(["nav.retired"], usage, []);
  assert.deepEqual(orphans, ["nav.retired"]);
});

test("plural forms are used through their base, and dead together when the base is", () => {
  const usage = usageOf(`t("alerts.count", { count })`);
  const { orphans } = analyse(["alerts.count_one", "alerts.count_other", "gone_one", "gone_other"], usage, []);
  assert.deepEqual(orphans, ["gone_one", "gone_other"]);
});

test("the allowlist keeps a key or a whole prefix built in a way no literal shows", () => {
  const { orphans } = analyse(["a.kept", "b.one", "b.two", "c.dead"], usageOf(""), [], {
    keys: ["a.kept"],
    prefixes: ["b."],
  });
  assert.deepEqual(orphans, ["c.dead"]);
});

test("a t() call naming a key en.json lacks is missing; a plural base is not", () => {
  const { calls } = scanSource(`t("a.here"); t(locale, "a.typo"); t("n.items", { count }); <Trans i18nKey="b.gone" />`);
  const { missing } = analyse(["a.here", "n.items_one", "n.items_other"], usageOf(""), calls);
  assert.deepEqual(missing, ["a.typo", "b.gone"]);
});

test("an apostrophe in a comment does not swallow the literals after it", () => {
  const usage = usageOf(`// don't drop this\nconst k = "nav.kept";`);
  assert.ok(usage.literals.has("nav.kept"));
});

test("removing keys deletes exactly their lines, mends the trailing comma and empty groups", () => {
  const catalog = '{\n  "a.one": "1",\n  "a.two": "2",\n\n  "b.one": "x",\n\n  "c.one": "3",\n  "c.two": "4"\n}\n';
  const out = removeKeys(catalog, new Set(["a.two", "b.one", "c.two"]));
  assert.equal(out, '{\n  "a.one": "1",\n\n  "c.one": "3"\n}\n');
  assert.deepEqual(Object.keys(JSON.parse(out)), ["a.one", "c.one"]);
});

test("removing keys leaves unicode escapes as they were written", () => {
  const catalog = '{\n  "a": "x \\u00b7 y",\n  "b": "z"\n}\n';
  assert.equal(removeKeys(catalog, new Set(["b"])), '{\n  "a": "x \\u00b7 y"\n}\n');
});
