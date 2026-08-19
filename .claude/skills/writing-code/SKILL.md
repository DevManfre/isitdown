---
name: writing-code
description: Use before writing or modifying any production code — new features, bug fixes, refactors, new files. Enforces reading the surrounding code first, building exactly the requested scope, matching existing conventions, and avoiding speculative abstraction.
---

# Writing Code

Code is written **for the task at hand** — not for an imagined future one. This skill is the discipline that keeps implementations small, idiomatic to the codebase they land in, and exactly as large as the request.

## The core rule

> Write the code the codebase would have written.

Every repo has an accent: naming, error handling, file layout, test style, comment density. Your job is to be indistinguishable from it. A reviewer should not be able to tell which lines are yours.

## Before writing a single line

Non-negotiable, in this order:

1. **Read the neighbours.** Open 2–3 existing files that do the same *kind* of thing (another adapter, another route, another notifier). That's your template.
2. **Read the project instructions.** `CLAUDE.md` / `AGENTS.md` / `README.md` and any repo-local skill in `.claude/skills/` that covers this task. Repo skills beat generic instinct.
3. **Find the seam.** Where does this change belong architecturally? If you have to break a stated boundary to make it fit, you've picked the wrong seam — stop and reconsider, don't punch through it.
4. **Check what already exists.** Grep for the helper before writing it. Duplicated utilities are the most common avoidable damage.

Skipping this and going straight to typing is the single biggest source of code that has to be thrown away.

## Scope: build exactly what was asked

- The request is the deliverable. Don't narrow it, don't widen it.
- **No speculative generality.** No config option "in case", no plugin hook for the one implementation that exists, no interface with a single implementer unless the codebase already establishes that pattern.
- **No unrequested refactors.** If you spot rot next to your change, mention it in one sentence and keep going. Don't fix it in the same pass.
- **No drive-by reformatting.** Formatting churn buries the real diff.
- If something in the request is genuinely blocked or wrong, build everything else in full and say plainly what you left out and why. Scaling down the work is the user's call.

## Conventions to match, not invent

| Aspect | Rule |
|---|---|
| Naming | Copy the local vocabulary. If the repo says `poller`, don't introduce `scheduler`. |
| File layout | One concept per file if that's the local pattern. Put the file where its siblings live. |
| Types | Match strictness. If the repo is strict TS with zod validation at boundaries, do that — no `any`, no unvalidated external input. |
| Errors | Match the local strategy (throw / Result / error callback). Don't introduce a second one. |
| Imports | Match the style (relative vs alias, barrel files vs direct). |
| Comments | Match the density. Explain *why*, never *what*. No comment that restates the line below it. |
| Logging | Use the existing logger and level conventions. No stray `console.log`. |
| Async | Match the pattern (async/await vs promise chains vs callbacks). |

## Writing the change

1. **Smallest correct change first.** Get it working end to end, then tidy — not the reverse.
2. **Handle the real failure modes**, not every conceivable one: bad external input, network failure, missing config. Validate at boundaries, trust internals.
3. **No dead code.** Nothing commented out, nothing unreachable, no unused exports "for later". Git remembers deleted code; the file doesn't need to.
4. **No placeholder logic** silently left behind. If something is genuinely a stub, it throws `not implemented` and is reported to the user — it never returns a fake value that looks like it worked.
5. **Secrets from env only.** Never hardcode a token, key, or URL with credentials. Never commit one, not even in an example file.

## After writing

- Run the type checker / linter / build. Fix what you broke.
- Run the relevant tests (see `testing-discipline`). If the change is behavioural, it needs a test — that's part of the task, not a follow-up.
- Re-read your own diff top to bottom before saying you're done. Debug logs left in? Unused import? A `TODO` you meant to resolve?
- Report honestly: what works, what's verified, what's untested. If tests fail, say so and show the output. Never report "done" for something you haven't run.

## Anti-patterns

| Anti-pattern | Instead |
|---|---|
| Rewriting a working file to "clean it up" while fixing one bug | Fix the bug. Mention the rest. |
| Adding an abstraction layer for one caller | Inline it. Abstract on the third repetition, not the first. |
| Inventing a new util module when one exists | Grep first. Extend the existing one. |
| Catching an error and swallowing it | Let it propagate, or handle it meaningfully. Never `catch {}`. |
| Copy-pasting a block with two values changed | Extract a parameter — *this* is when abstraction is earned. |
| Adding a dependency for something trivial | Write the 10 lines. Adding a dep is a decision to flag, not to make silently. |
| Leaving the build broken "because it's a WIP" | Every stop point compiles. |

## Red flags

| Thought | Reality |
|---|---|
| "I'll make it configurable just in case" | YAGNI. One caller, one behaviour. |
| "I don't need to read the other adapter, I know the pattern" | You know *a* pattern. Read the local one. |
| "I'll fix this ugly function while I'm here" | Separate concern, separate commit — or not at all. |
| "This mostly works, close enough" | Run it. "Mostly" is a bug report you're writing for someone else. |
| "I'll add tests after" | Behavioural change without a test is unfinished. |
| "The user will probably also want X" | Ask, or do the asked thing. Don't guess and build. |
