/**
 * What a message says about a provider's runbook — roadmap 5.1. A message is
 * no place for the whole Markdown, so it carries the part an operator woken at
 * 3 a.m. acts on: the runbook's first link when it has one (most runbooks live
 * in a wiki, and the field then points there), otherwise its first line, which
 * is the first thing to do. Null for no runbook, or one with nothing to quote.
 */
const MAX_HINT = 140;

export function runbookHint(markdown: string | undefined): string | null {
  if (markdown === undefined) return null;
  const link = /https?:\/\/[^\s<>()[\]]+/.exec(markdown)?.[0];
  if (link !== undefined) return link.replace(/[.,;:!?]+$/, "");
  for (const raw of markdown.split("\n")) {
    // Markdown's own punctuation is dropped: a heading marker, a list bullet or
    // emphasis reads as noise once it is out of the renderer.
    const line = raw
      .replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, "")
      .replace(/[*_`]/g, "")
      .trim();
    if (line === "") continue;
    return line.length > MAX_HINT ? `${line.slice(0, MAX_HINT - 1)}…` : line;
  }
  return null;
}
