---
name: readme-translation-sync
description: Use whenever README.md or a file under docs/ is edited, or when a change adds a flag, route, env var, config key, script, adapter, notifier or view that the documentation describes — every edit to an English page has to land in its <name>.it.md twin (and any other <name>.<lang>.md) in the same pass, section for section. Also use when asked whether the translations have drifted.
---

# Documentation Translation Sync

The manual is `README.md` plus one file per section under `docs/`
(`configuration.md`, `docker.md`, `verifying.md`, `api.md`, `how-it-works.md`,
`theming.md`, `development.md`) — roadmap 7.5. Each has a twin beside it whose
name carries the language: `README.it.md`, `docs/api.it.md`, and so on. A twin is
a **translation of its own source file**, not a second document with its own
opinions, and the two drift the moment one is edited alone — a drifted manual is
worse than a missing one: an operator following the Italian one runs a flag that
no longer exists.

## The rule

**An edit to an English page is not finished until every `<name>.<lang>.md`
beside it carries the same edit.** Same section, same position, same code,
translated prose.

The direction is one-way: English first, then the translations. Never write a
paragraph into a translation that does not exist in its source — if the
information only exists in Italian, it is invisible to everyone else and will be
deleted by the next sync.

A section stays in the file it is in. Moving one between pages is a real change
to both languages, and the parity gate compares one pair at a time precisely so
that a section quietly relocated in only one language is reported rather than
cancelled out.

## When this applies

- Any direct edit to `README.md` or to a file under `docs/`.
- Any change the documentation describes even though the change itself is in code:
  a new HTTP route or query parameter, an env var, a `config.yml` key, an npm
  script, a new adapter or notifier, a new dashboard view, a changed default, a
  new roadmap row that the README's own roadmap section names.
- Before saying a documentation task is done.

It does **not** apply to `ROADMAP.md`, `CLAUDE.md` or the skills: those are
English-only by design and have no translated twin.

## Procedure

1. **Find the translations.** `ls README*.md docs/*.md` — every page whose name
   has no language part is a source, and each `<name>.<lang>.md` beside it is one
   of its translations. Everything below runs once per translated file, against
   *its own* source.
2. **Make the English edit first**, completely. Do not interleave.
3. **Locate the same place in the translation.** The section numbers are mirrored
   (`## 6. HTTP API` ↔ `## 6. API HTTP`), so find the section by its number, then
   the anchor paragraph or the code block nearest your edit — not by line number,
   which the two files never share.
4. **Port the edit.** Translate the prose; copy everything else verbatim (see
   *What is never translated*).
5. **Update the table of contents** in the translation if you added, removed or
   renamed a heading — `## Contents` in English, `## Indice` in Italian. The
   anchor links point at the translated headings, so a renamed Italian heading
   needs its own anchor updated, not the English one. A link that crosses files
   carries the translation's own name (`docs/api.it.md#…`, not `docs/api.md#…`).
6. **Verify parity** with the commands below, and read your own diff in both
   files side by side.

## What is never translated

Copy these byte-for-byte, inside prose as well as inside code blocks — a
translated identifier is a broken instruction:

- Commands, flags, npm scripts, Docker image tags, file and directory paths.
- Env var names, config keys, JSON/YAML field names, i18n catalog keys.
- Route paths, query parameter names, HTTP header names, status values
  (`operational`, `major_outage`, …), adapter ids, channel ids.
- Code, output samples, log lines, error strings.
- Emoji, badges, URLs.

Translate: prose, headings, table headers and their non-identifier cells, list
items, comments inside a code block **only** when the block is illustrative
rather than copy-pasteable (a `config.yml` example's comments: yes; a shell
transcript: no).

## Verify parity

```bash
# Every pair at once — the gate CI runs, and the fastest answer.
npm run check:readme

# One pair by hand, when the gate names a drift and you want to see it:
pair=docs/api        # or README, or docs/configuration, …
diff <(grep -oE '^#+ [0-9]+(\.[0-9]+)*' "$pair.md") <(grep -oE '^#+ [0-9]+(\.[0-9]+)*' "$pair.it.md")

for f in "$pair.md" "$pair.it.md"; do
  printf '%s: h2=%s h3=%s h4=%s fences=%s tables=%s\n' "$f" \
    "$(grep -c '^## ' "$f")" "$(grep -c '^### ' "$f")" "$(grep -c '^#### ' "$f")" \
    "$(grep -c '^```' "$f")" "$(grep -c '^|' "$f")"
done

# The identifiers themselves: every route, env var and script named in one file
# should be named in the other.
diff <(grep -oE '`(/[a-z0-9/:._-]+|[A-Z][A-Z0-9_]{3,}|npm run [a-z:]+)`' "$pair.md" | sort -u) \
     <(grep -oE '`(/[a-z0-9/:._-]+|[A-Z][A-Z0-9_]{3,}|npm run [a-z:]+)`' "$pair.it.md" | sort -u)
```

The first two must come back empty / equal. The third is a hint, not a gate:
a legitimate difference exists (a translated example value), so read what it
prints rather than chasing it to zero.

Then, whatever the greps say, **read both diffs**: `git diff` on the pair you
touched. Parity of structure is not parity of meaning.

## Anti-patterns

| Anti-pattern | Instead |
|---|---|
| "I'll sync the Italian README in a follow-up" | Same pass. A follow-up is how the two files got out of step in the first place. |
| Translating a flag, a key or a path | Copy identifiers verbatim; translate the sentence around them. |
| Rewriting the Italian section from scratch because the English one moved | Port the edit. The rest of the translation is already agreed wording. |
| Adding a note only to a translation | Add it to the English source first, then translate it. |
| Moving a section to another page in English only | Move it in both, in the same pass: the gate compares one pair at a time and will report the hole. |
| Machine-translating a whole section and moving on | Keep the existing vocabulary of the file (`provider`, `adapter`, `notifier` stay English nouns in the Italian text — that is the established register). |
| Leaving a heading renamed in one file only | The `Indice`/`Contents` anchors break silently; update both. |

## Reporting

Say which files you touched and that parity was checked, e.g. "docs/api.md and
docs/api.it.md both updated (section 6.4); npm run check:readme clean". If you
could not produce a confident translation of a passage, put the English text in
place, keep the structure aligned, and say which passage needs a native review —
never skip the section and leave a hole.
