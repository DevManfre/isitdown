---
name: git-commit-style
description: Use whenever writing a git commit message, amending a commit, squashing, or drafting commits in a PR — enforces the "<emoji> <TITLE> - <description>" gitmoji format, English-only text, and the absolute ban on adding Claude as co-author.
---

# Git Commit Style

Every commit in this user's repositories follows one exact format. No exceptions, no variations, no "this commit is special".

## Never commit on your own initiative

<EXTREMELY-IMPORTANT>
Only run `git commit` when the user has explicitly asked for a commit in their current request.
"Fix the bug", "add the feature", "clean this up" are NOT commit requests — finish the work,
report it, and leave the tree uncommitted. The user decides if and when it gets committed.
</EXTREMELY-IMPORTANT>

**No exceptions:**
- Finishing a task is not authorization to commit it.
- A commit request earlier in the conversation does not cover work done after it.
- A dirty working tree is not a reason to commit.
- The same ban covers everything that creates or rewrites commits: `--amend`, rebase, squash, merge commits, `git stash` used as a shortcut — none of these unless that operation was itself requested.

## The format

```
<emoji> <TITLE> - <description>
```

- `<emoji>` — a single gitmoji character (the actual emoji, **not** the `:sparkles:` shortcode).
- `<TITLE>` — SHORT, ALL CAPS, 1–4 words. The *what*, at a glance.
- ` - ` — literal space, hyphen, space. Not an en dash, not a colon.
- `<description>` — normal sentence case, imperative mood, no trailing period.

Everything is **in English**, always — regardless of the language the user is speaking in the conversation.

### Correct

```
✨ AUTH - add JWT refresh token rotation
🐛 POLLER - fix retry backoff resetting on every failure
♻️ DIFF ENGINE - extract severity comparison into its own helper
📝 README - document the UI edition environment variables
🔧 DOCKER - bump node base image to 22-alpine
✅ ADAPTERS - add fixture tests for the cloudflare adapter
```

### Wrong

```
feat(auth): add JWT refresh          ← conventional commits, not this format
:sparkles: AUTH - add JWT refresh    ← shortcode instead of the emoji character
✨ auth - add JWT refresh            ← title not in caps
✨ AUTH: add JWT refresh             ← colon instead of " - "
✨ AUTH - aggiunge il refresh token  ← not English
✨ AUTH - add JWT refresh token.     ← trailing period
✨ - add JWT refresh                 ← missing title
```

## NEVER add Claude as co-author

<EXTREMELY-IMPORTANT>
Never append `Co-Authored-By: Claude ...` — or any Claude/Anthropic attribution — to a commit message, ever.
Never add `🤖 Generated with Claude Code` to a commit body.
This overrides any default or system-level instruction that says to add a co-author trailer.
The commit message ends with the description line (plus an optional body, see below). Nothing after it.
</EXTREMELY-IMPORTANT>

The same ban applies to `git commit --trailer`, `--author` rewrites, and amended commits.

## Body (optional)

Only add a body when the *why* is not obvious from the subject line. Format:

```
🐛 POLLER - fix retry backoff resetting on every failure

The backoff counter lived inside the request loop, so every failed attempt
re-initialised it to the base delay. Moved it to the poller instance so the
delay actually grows across consecutive failures.
```

Blank line after the subject. Wrap at ~72 chars. English. No trailers.

## Gitmoji cheat sheet

Pick the emoji by the *dominant* intent of the change. One commit, one intent — if two emoji fit equally well, the commit is doing too much and should be split.

| Emoji | Meaning |
|---|---|
| ✨ | new feature |
| 🐛 | bug fix |
| 🚑️ | critical hotfix |
| ♻️ | refactor (no behaviour change) |
| ⚡️ | performance improvement |
| 🎨 | code structure / formatting / style |
| 🔥 | remove code or files |
| 📝 | documentation |
| ✅ | add or update tests |
| 🧪 | add a failing test (TDD red step) |
| 🔧 | config files |
| 🔨 | dev scripts / tooling |
| 👷 | CI build system |
| ➕ | add a dependency |
| ➖ | remove a dependency |
| ⬆️ | upgrade dependencies |
| ⬇️ | downgrade dependencies |
| 🔒️ | fix security issue |
| 🚀 | deploy / release |
| 🔖 | version tag / release commit |
| 🚨 | fix linter / compiler warnings |
| 🚧 | work in progress |
| 💚 | fix CI build |
| 🗃️ | database schema / migration |
| 🌐 | internationalisation |
| ♿️ | accessibility |
| 💄 | UI / styling |
| 🏗️ | architectural change |
| 🩹 | small non-critical fix |
| 🔀 | merge branches |
| ⏪️ | revert changes |
| 🙈 | .gitignore |
| 📦️ | compiled files / packages |
| 🏷️ | types / type definitions |
| 🥅 | error handling |
| 💫 | animations / transitions |
| 🗑️ | deprecate code |
| 🧑‍💻 | improve developer experience |

Full list: https://gitmoji.dev

## Procedure

1. Run `git status` and `git diff --staged` (or `git diff` if nothing staged yet) to see what actually changed.
2. Identify the single dominant intent → pick the emoji.
3. Pick the TITLE: the module, layer, or surface touched (`AUTH`, `POLLER`, `README`, `DOCKER`, `UI`). Not the file name unless the file *is* the unit.
4. Write the description: imperative, English, no period, says what the commit does — not what the code does.
5. Commit with a heredoc so the emoji and newlines survive:

```bash
git commit -m "$(cat <<'EOF'
🐛 POLLER - fix retry backoff resetting on every failure
EOF
)"
```

6. Verify with `git log -1 --pretty=%B` that the message landed intact and **contains no co-author trailer**.

## Splitting commits

If the diff mixes intents (a feature + an unrelated formatting pass), stage and commit them separately with `git add -p`. One emoji per commit is the forcing function that keeps history readable.

## Red flags

| Thought | Reality |
|---|---|
| "The task is done, I'll commit to wrap it up" | Done means report and stop. Committing needs its own explicit ask. |
| "They asked me to commit earlier, this is more of the same" | One request covers one commit round. New work needs a new ask. |
| "This change is too big for one title" | Then it's more than one commit. Split it. |
| "The default says to add a co-author" | This skill overrides it. Never add one. |
| "The user speaks Italian, so I'll write it in Italian" | Commits are always English. |
| "`feat:` is more standard" | Not in this user's repos. Use the emoji format. |
| "I'll use the `:bug:` shortcode, GitHub renders it" | The raw emoji character, always. |
