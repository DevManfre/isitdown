/**
 * Per-channel message templates — roadmap 3.15.
 *
 * The row that asked for this also named the trap: a template feature grows
 * conditionals, then loops, then filters, and ends up a templating language
 * nobody wanted inside a status poller. The line drawn here is that a template
 * is *substitution only*. `{{provider}}` is replaced by a string. There is no
 * `{{#if}}`, no `{{a|upper}}`, no expression of any kind, and adding one would
 * be a change to this file rather than something an operator can put in a
 * config value.
 *
 * It also has to live with the "formatting lives in the notifier" convention,
 * and it does — twice over. This file holds only the vocabulary and the
 * substitution; the *values* behind the tokens are resolved in `formatting.ts`,
 * from the same catalog and the same helpers the default message is assembled
 * from. A templated message therefore says the same words in the same locale as
 * a default one. A template rearranges them; it cannot invent new ones. That
 * split is also what keeps the two files from importing each other.
 *
 * `{{message}}` is the whole default message, which is what makes the common
 * request — "the usual text, with our ticket prefix on it" — a one-line
 * template rather than a re-implementation of the catalog.
 *
 * Three deliberate limits:
 *
 * - An unknown token is rejected where the template is saved, not at send time.
 *   A typo that survives to an outage is a message reading `{{provder}}` to
 *   whoever is being paged, and the moment to catch it is while somebody is
 *   looking at a form.
 * - A token with nothing behind it for this change renders empty — there is no
 *   incident title on a status change — and a line that held only such tokens
 *   is dropped rather than left as a dangling label. A template written for
 *   incidents therefore degrades into something readable on a maintenance
 *   window instead of into punctuation.
 * - A digest is never templated. A template describes one change and a digest
 *   is a batch of them; applying one per batch would either repeat the heading
 *   N times or throw the batch away. Digests keep their own rendering, and the
 *   documentation says so.
 */

/**
 * Every token a template may name, with the sentence shown beside it in the
 * dashboard. The keys are the contract: this list is what the validator checks
 * against and what `docs/configuration.md` documents, and `formatting.ts` has
 * to resolve every one of them — `template.test.ts` holds the two together.
 */
export const TEMPLATE_TOKENS = {
  message: "The whole default message, exactly as the channel would otherwise have sent it.",
  emoji: "The severity's own emoji, the one the default message opens with.",
  provider: "The provider's display name.",
  providerId: "The provider's id, as configured.",
  kind: "What happened, in the diff engine's own word: incident_opened, status_change, …",
  severity: "The current severity, upper-cased — the heading word.",
  status: "The current severity, in sentence case.",
  previous: "The severity before this change; empty when there was no prior reading.",
  component: "The component that changed; empty unless this is a component change.",
  title: "The incident's or maintenance window's own title; empty when there is neither.",
  incidentStatus: "The provider's own lifecycle word for the incident, translated where known.",
  url: "The provider's public status page.",
  at: "When it happened, UTC.",
} as const;

export type TemplateToken = keyof typeof TEMPLATE_TOKENS;

export type TemplateValues = Record<TemplateToken, string>;

/**
 * Built fresh per call rather than kept at module scope: a `RegExp` with `g`
 * carries `lastIndex` between uses, and a shared one made every second
 * validation of the same template disagree with the first.
 */
const tokenPattern = (): RegExp => /\{\{\s*([A-Za-z]+)\s*\}\}/g;

/**
 * How long a template may be. Generous for a message, small enough that the
 * field cannot become a place to keep a document — and the channels this goes
 * out over have their own, much lower, limits anyway.
 */
export const TEMPLATE_MAX_LENGTH = 2000;

/**
 * Every problem with a template, in English, ready to be shown beside the
 * field. An empty list means the template is usable.
 *
 * A list rather than a throw on the first problem: an operator pasting a
 * template with two typos in it should meet both at once.
 */
export function templateProblems(template: string): string[] {
  const problems: string[] = [];
  if (template.length > TEMPLATE_MAX_LENGTH) {
    problems.push(`a template may be at most ${TEMPLATE_MAX_LENGTH} characters`);
  }
  const unknown = new Set<string>();
  let found = 0;
  for (const [, name] of template.matchAll(tokenPattern())) {
    found += 1;
    if (name !== undefined && !(name in TEMPLATE_TOKENS)) unknown.add(name);
  }
  for (const name of [...unknown].sort()) {
    problems.push(`unknown token {{${name}}} — known tokens are ${Object.keys(TEMPLATE_TOKENS).join(", ")}`);
  }
  // A non-empty template with no token at all is almost always a mistake —
  // most often single braces — and it would send one fixed sentence for every
  // change, which from the receiving end is indistinguishable from a channel
  // that has stopped reporting what happened.
  if (template.trim() !== "" && found === 0) {
    problems.push("a template names no token, so every notification would read the same");
  }
  return problems;
}

/**
 * The template, filled in.
 *
 * Line-wise rather than over the whole string, which is what lets a line whose
 * tokens all came back empty disappear instead of leaving "Incident:" behind. A
 * line carrying literal text is always kept — the operator wrote it, so it is
 * not this function's business to decide it was conditional.
 */
export function fillTemplate(template: string, values: TemplateValues): string {
  const lines: string[] = [];
  for (const line of template.split("\n")) {
    let sawToken = false;
    const rendered = line.replace(tokenPattern(), (match, name: string) => {
      if (!(name in values)) return match;
      sawToken = true;
      return values[name as TemplateToken];
    });
    const literal = line.replace(tokenPattern(), "").trim();
    // Dropped only when the line was made *of* tokens: "Provider: {{provider}}"
    // keeps its label, a bare "{{title}}" line goes away.
    if (sawToken && literal === "" && rendered.trim() === "") continue;
    lines.push(rendered.trimEnd());
  }
  // Collapsing runs of blank lines is the other half of dropping one: two
  // adjacent token-only lines that both resolved to nothing would otherwise
  // leave a hole where a paragraph break was meant to be.
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
