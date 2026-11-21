// CHANGELOG.md — every release's notes, newest first (roadmap 14.1).
//
// The same grouping as the GitHub release body (tools/release-notes.mjs), one
// section per tag, so the file is generated, never edited by hand: a hand edit
// is overwritten by the next release.
//
// CLI: node tools/changelog.mjs [--release X.Y.Z]
// Rewrites CHANGELOG.md from the `v*` tags. With --release, the commits since
// the last tag become a section for vX.Y.Z dated today — the release flow runs
// it right before the bump commit, so the changelog ships inside the release
// it describes.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { groupCommits, renderNotes } from "./release-notes.mjs";

const HEADER = [
  "# Changelog",
  "",
  "Every release of IsItDown, newest first, grouped by the surface each commit",
  "touched. Generated from the commit log by `tools/changelog.mjs` — don't edit",
  "it by hand; the release flow regenerates it.",
  "",
];

/**
 * @param {readonly { version: string, date: string, subjects: readonly string[] }[]} releases
 *   newest first; `version` with its leading `v`, `date` as YYYY-MM-DD
 * @returns {string} the whole CHANGELOG.md
 */
export function renderChangelog(releases) {
  const lines = [...HEADER];
  for (const release of releases) {
    lines.push(`## ${release.version} — ${release.date}`, "");
    lines.push(renderNotes(groupCommits(release.subjects)));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function subjects(range) {
  return git("log", "--no-merges", "--pretty=%s", range).split("\n").filter(Boolean);
}

if (process.argv[1]?.endsWith("changelog.mjs")) {
  const args = process.argv.slice(2);
  const releaseAt = args.indexOf("--release");
  const next = releaseAt === -1 ? null : args[releaseAt + 1];
  if ((releaseAt !== -1 && !/^\d+\.\d+\.\d+$/.test(next ?? "")) || args.length > (next ? 2 : 0)) {
    console.error("usage: node tools/changelog.mjs [--release X.Y.Z]");
    process.exit(2);
  }

  // Oldest first, so each tag's range starts at the one before it.
  const tags = git("tag", "--list", "v*", "--sort=v:refname").split("\n").filter(Boolean);
  const releases = tags.map((tag, i) => ({
    version: tag,
    date: git("log", "-1", "--format=%cs", tag),
    subjects: subjects(i === 0 ? tag : `${tags[i - 1]}..${tag}`),
  }));
  if (next !== null) {
    const last = tags.at(-1);
    releases.push({
      version: `v${next}`,
      date: new Date().toISOString().slice(0, 10),
      subjects: subjects(last === undefined ? "HEAD" : `${last}..HEAD`),
    });
  }

  writeFileSync("CHANGELOG.md", renderChangelog(releases.reverse()));
}
