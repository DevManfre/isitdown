// Release notes from commit subjects. Every commit in this repository reads
// `<emoji> <TITLE> - <description>`, so the log is machine-parseable: grouping
// by TITLE turns it into a changelog by surface (POLLER, UI, DOCKER, …) rather
// than a flat commit dump.
//
// CLI: node tools/release-notes.mjs [<from-ref>] <to-ref>
// With no <from-ref> the previous tag reachable from <to-ref> is used, and if
// there is none, the whole history.
import { execFileSync } from "node:child_process";

/** `<emoji> <TITLE> - <description>`: the title is everything up to the first " - ". */
const SUBJECT = /^(\S+)\s+([^-]+?)\s+-\s+(.+)$/u;

/**
 * @param {readonly string[]} subjects commit subjects, newest first
 * @returns {{ title: string, entries: { emoji: string, description: string }[] }[]}
 *   groups in first-seen order, entries in log order
 */
export function groupCommits(subjects) {
  /** @type {Map<string, { emoji: string, description: string }[]>} */
  const groups = new Map();

  for (const subject of subjects) {
    const match = SUBJECT.exec(subject.trim());
    // A subject that does not follow the convention is kept verbatim rather
    // than dropped: a missing line in a changelog is worse than an ugly one.
    const title = match === null ? "Other" : match[2].trim();
    const entry =
      match === null
        ? { emoji: "", description: subject.trim() }
        : { emoji: match[1], description: match[3].trim() };
    const entries = groups.get(title);
    if (entries === undefined) groups.set(title, [entry]);
    else entries.push(entry);
  }

  return [...groups].map(([title, entries]) => ({ title, entries }));
}

/**
 * @param {readonly { title: string, entries: { emoji: string, description: string }[] }[]} groups
 * @returns {string} Markdown, ready for a GitHub release body
 */
export function renderNotes(groups) {
  if (groups.length === 0) return "No commits in this release.\n";

  const lines = [];
  for (const group of groups) {
    lines.push(`### ${group.title}`, "");
    for (const entry of group.entries) {
      lines.push(`- ${entry.emoji === "" ? "" : `${entry.emoji} `}${entry.description}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function previousTag(to) {
  try {
    return git("describe", "--tags", "--abbrev=0", `${to}^`);
  } catch {
    return null; // First release: no earlier tag to diff against.
  }
}

if (process.argv[1]?.endsWith("release-notes.mjs")) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.length > 2) {
    console.error("usage: node tools/release-notes.mjs [<from-ref>] <to-ref>");
    process.exit(2);
  }
  const to = args[args.length - 1];
  const from = args.length === 2 ? args[0] : previousTag(to);
  const range = from === null ? to : `${from}..${to}`;
  const subjects = git("log", "--no-merges", "--pretty=%s", range).split("\n").filter(Boolean);
  process.stdout.write(renderNotes(groupCommits(subjects)));
}
