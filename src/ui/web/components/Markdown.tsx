import type { ReactNode } from "react";

/**
 * The little Markdown a runbook needs (roadmap 5.1): headings, bullet and
 * numbered lists, paragraphs, **bold**, *italic*, `code` and links. Built from
 * React elements rather than HTML, so text the operator typed can never become
 * markup — no sanitiser to keep up to date, and no dependency for six rules.
 *
 * Links are only ever http(s): a `javascript:` URL in a runbook would be one
 * click from running in the dashboard's origin.
 */

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|(?<![A-Za-z0-9])_[^_\s][^_]*_(?![A-Za-z0-9])|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<>()]+)/g;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const at = match.index;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyBase}-${at}`;
    if (token.startsWith("**")) out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) out.push(<code key={key} className="rounded bg-muted px-1 font-mono text-xs">{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      out.push(
        <a key={key} href={token.slice(split + 2, -1)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
          {token.slice(1, split)}
        </a>,
      );
    } else if (token.startsWith("http")) {
      const href = token.replace(/[.,;:!?]+$/, "");
      out.push(
        <a key={key} href={href} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">
          {href}
        </a>,
      );
      if (href.length < token.length) out.push(token.slice(href.length));
    } else out.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const key = `p${blocks.length}`;
    blocks.push(<p key={key}>{inline(paragraph.join(" "), key)}</p>);
    paragraph = [];
  };
  const flushList = (): void => {
    if (list === null) return;
    const key = `l${blocks.length}`;
    const items = list.items.map((item, index) => <li key={`${key}-${index}`}>{inline(item, `${key}-${index}`)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={key} className="list-decimal pl-5">{items}</ol>
      ) : (
        <ul key={key} className="list-disc pl-5">{items}</ul>
      ),
    );
    list = null;
  };

  for (const raw of source.split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else if (heading !== null) {
      flushParagraph();
      flushList();
      const key = `h${blocks.length}`;
      blocks.push(
        <p key={key} className="font-semibold">
          {inline(heading[2] ?? "", key)}
        </p>,
      );
    } else if (bullet !== null || numbered !== null) {
      flushParagraph();
      const ordered = numbered !== null;
      if (list !== null && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)?.[1] ?? "");
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();

  return <div className={className}>{blocks}</div>;
}
