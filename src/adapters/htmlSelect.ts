/**
 * The smallest HTML reader that can answer "what does the element at this CSS
 * selector say?".
 *
 * It exists because the scrape adapter needs a selector and nothing else a real
 * parser offers, and this project's whole pitch is a handful of runtime
 * dependencies — adding a DOM implementation to read one string off one page
 * would cost more than the feature is worth. So: a tag scanner that keeps an
 * element stack, and a matcher for the selector subset an operator can
 * reasonably be asked to type (descendant and child combinators over
 * tag/#id/.class/[attr] compounds).
 *
 * What it deliberately does not do is recover from broken markup the way a
 * browser does. A page whose structure moved should make the adapter throw, not
 * make it guess — see the adapter's own comment on why silence is the failure
 * mode worth avoiding here.
 */

/** Elements HTML closes for you; a stack that waits for `</br>` never unwinds. */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** Elements whose content is text, not markup: a `<` inside them opens nothing. */
const RAW_TEXT_TAGS = new Set(["script", "style"]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  // The punctuation status pages actually use in a headline sentence. Not a
  // full entity table: an unknown entity is left as written, which reads
  // oddly but never loses the words around it.
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  middot: "\u00b7",
  times: "\u00d7",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x") || body.startsWith("#X")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

export interface HtmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}

export type HtmlNode = HtmlElement | { text: string };

const isElement = (node: HtmlNode): node is HtmlElement => "tag" in node;

const ATTR = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(ATTR)) {
    // An attribute with no value is present, which is what `[disabled]` asks
    // about; the empty string is the closest thing to "present, says nothing".
    attrs[match[1]!.toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g;

/**
 * Reads a document into a tree. The root is a synthetic element holding
 * whatever the document turned out to contain, so a fragment with no `<html>`
 * around it parses exactly like a whole page.
 *
 * Unbalanced markup is forgiven in one direction only: a close tag with no
 * matching open is dropped, and elements still open at the end of the document
 * are closed there. Neither can misplace an element the selector then finds
 * under the wrong ancestor, which is the failure that would matter.
 */
export function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { tag: "#root", attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  let cursor = 0;

  const pushText = (raw: string): void => {
    if (raw === "") return;
    stack[stack.length - 1]!.children.push({ text: decodeEntities(raw) });
  };

  // A fresh regex per document rather than `TOKEN.matchAll`: the raw-text skip
  // below moves the scan position, and `matchAll` copies `lastIndex` off the
  // pattern it is given — so a shared instance would carry one document's
  // offset into the next one and start it halfway through.
  const scanner = new RegExp(TOKEN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(html)) !== null) {
    const [whole, closing, name, rawAttrs, selfClosing] = match;
    pushText(html.slice(cursor, match.index));
    cursor = match.index + whole.length;

    // A comment, doctype or processing instruction: consumed, contributes nothing.
    if (name === undefined) continue;
    const tag = name.toLowerCase();

    if (closing === "/") {
      // Unwind to the nearest matching open element. An unmatched close tag
      // finds nothing and is ignored rather than collapsing the whole stack.
      const depth = stack.findLastIndex((element) => element.tag === tag);
      if (depth > 0) stack.length = depth;
      continue;
    }

    const element: HtmlElement = { tag, attrs: attributes(rawAttrs ?? ""), children: [] };
    stack[stack.length - 1]!.children.push(element);
    if (selfClosing === "/" || VOID_TAGS.has(tag)) continue;

    if (RAW_TEXT_TAGS.has(tag)) {
      // Skip the body wholesale: a `<div>` written inside a script is a string,
      // and treating it as markup is how a selector matches something that is
      // not on the page at all.
      const end = html.toLowerCase().indexOf(`</${tag}`, cursor);
      cursor = end === -1 ? html.length : html.indexOf(">", end) + 1;
      scanner.lastIndex = cursor;
      continue;
    }

    stack.push(element);
  }
  pushText(html.slice(cursor));

  return root;
}

/** Every text node under an element, whitespace collapsed the way a browser shows it. */
export function textOf(element: HtmlElement): string {
  const parts: string[] = [];
  const walk = (node: HtmlNode): void => {
    if (isElement(node)) {
      for (const child of node.children) walk(child);
      return;
    }
    parts.push(node.text);
  };
  walk(element);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

interface Compound {
  tag?: string | undefined;
  id?: string | undefined;
  classes: string[];
  attrs: { name: string; value?: string | undefined }[];
}

interface Step {
  compound: Compound;
  /** How this step relates to the one before it. The first step has none. */
  combinator: "descendant" | "child" | undefined;
}

const PIECE = /#([\w-]+)|\.([\w-]+)|\[\s*([\w:-]+)\s*(?:([~^$*|]?=)\s*"?([^\]"]*)"?\s*)?\]|([a-zA-Z][\w-]*|\*)/g;

function parseCompound(source: string): Compound {
  const compound: Compound = { classes: [], attrs: [] };
  let consumed = 0;
  for (const match of source.matchAll(PIECE)) {
    consumed += match[0].length;
    if (match[1] !== undefined) compound.id = match[1];
    else if (match[2] !== undefined) compound.classes.push(match[2]);
    else if (match[3] !== undefined) {
      // Only plain equality and bare presence are supported; `~=` and friends
      // would be a selector engine, and this is a way to name one element.
      if (match[4] !== undefined && match[4] !== "=") {
        throw new Error(`unsupported attribute operator in selector: ${match[0]}`);
      }
      compound.attrs.push({ name: match[3].toLowerCase(), ...(match[5] === undefined ? {} : { value: match[5] }) });
    } else if (match[6] !== undefined && match[6] !== "*") compound.tag = match[6].toLowerCase();
  }
  if (consumed !== source.length) throw new Error(`unsupported selector: ${source}`);
  return compound;
}

/**
 * Parses the selector subset this reader supports. Anything outside it — a
 * comma-separated list, a pseudo-class, a sibling combinator — throws here
 * rather than silently matching nothing, so an operator finds out that their
 * selector is unsupported instead of watching a provider read `unknown`
 * forever.
 */
export function parseSelector(selector: string): Step[] {
  const trimmed = selector.trim();
  if (trimmed === "") throw new Error("selector is empty");
  if (trimmed.includes(",")) throw new Error("a selector list is not supported: name one element");

  const steps: Step[] = [];
  let pending: "descendant" | "child" | undefined;
  for (const token of trimmed.replace(/\s*>\s*/g, " > ").split(/\s+/).filter((part) => part !== "")) {
    if (token === ">") {
      if (steps.length === 0) throw new Error(`unsupported selector: ${selector}`);
      pending = "child";
      continue;
    }
    steps.push({ compound: parseCompound(token), combinator: steps.length === 0 ? undefined : (pending ?? "descendant") });
    pending = undefined;
  }
  if (pending !== undefined) throw new Error(`unsupported selector: ${selector}`);
  return steps;
}

function matchesCompound(element: HtmlElement, compound: Compound): boolean {
  if (compound.tag !== undefined && element.tag !== compound.tag) return false;
  if (compound.id !== undefined && element.attrs["id"] !== compound.id) return false;
  if (compound.classes.length > 0) {
    const classes = new Set((element.attrs["class"] ?? "").split(/\s+/));
    if (compound.classes.some((name) => !classes.has(name))) return false;
  }
  return compound.attrs.every(({ name, value }) => {
    const actual = element.attrs[name];
    if (actual === undefined) return false;
    return value === undefined || actual === value;
  });
}

/**
 * Whether the ancestors of a matched element satisfy the steps to its left.
 * `path` is the chain from the outermost element down to the matched one's
 * parent, and the steps are read right to left because that is the direction a
 * selector constrains in.
 */
function matchesAncestors(path: HtmlElement[], steps: Step[]): boolean {
  let index = path.length - 1;
  for (let position = steps.length - 2; position >= 0; position -= 1) {
    const step = steps[position]!;
    if (steps[position + 1]!.combinator === "child") {
      const parent = path[index];
      if (parent === undefined || !matchesCompound(parent, step.compound)) return false;
      index -= 1;
      continue;
    }
    // Descendant: any ancestor will do, so walk up until one matches.
    while (index >= 0 && !matchesCompound(path[index]!, step.compound)) index -= 1;
    if (index < 0) return false;
    index -= 1;
  }
  return true;
}

/** The first element in document order the selector matches, or null. */
export function select(html: string, selector: string): HtmlElement | null {
  const steps = parseSelector(selector);
  const last = steps[steps.length - 1]!;
  const path: HtmlElement[] = [];

  const walk = (element: HtmlElement): HtmlElement | null => {
    if (matchesCompound(element, last.compound) && matchesAncestors(path, steps)) return element;
    path.push(element);
    for (const child of element.children) {
      if (!isElement(child)) continue;
      const found = walk(child);
      if (found !== null) return found;
    }
    path.pop();
    return null;
  };

  for (const child of parseHtml(html).children) {
    if (!isElement(child)) continue;
    const found = walk(child);
    if (found !== null) return found;
  }
  return null;
}

/** The text the selector points at, or null when it points at nothing. */
export function selectText(html: string, selector: string): string | null {
  const element = select(html, selector);
  return element === null ? null : textOf(element);
}
