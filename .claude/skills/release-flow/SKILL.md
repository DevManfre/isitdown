---
name: release-flow
description: Ship IsItDown from dev to a published release — push dev, wait for CI, bump the version, merge into main with mergeclean, tag, and wait for the Release workflow to publish the GHCR images and the GitHub release. Use whenever the user asks to release, cut a version, publish a new version, ship to main, merge dev into main, or push a tag.
---

# Release Flow

One release = two CI waits, not four. CI runs once on `dev` *with the version already bumped*; `main` then receives the same tree, so its own CI run is a formality the Release workflow waits on by itself (its first step blocks until CI's `verify` check on the tagged commit is green and stops the release otherwise). Images and the GitHub release are public and effectively irreversible, so that gate is never skipped — it just isn't babysat by hand twice.

Don't re-run locally what CI is about to run: no `npm run preversion`, no `npm ci && npm test` after the merge. Every check below that replaces a test run proves the code is *identical* to code CI already passed.

Branch model: `main` carries only the product, `dev` carries the product *plus* `.claude/`, `CLAUDE.md`, `.mergeexclude`, `.githooks/`, `scripts/`. `main` is a filtered replay of `dev` (rewritten SHAs), so merges are always `git mergeclean dev`, never `git merge dev` — guard hooks abort a plain merge.

## Preconditions

```bash
git status -sb                          # clean tree, on dev
git config --get alias.mergeclean       # empty → scripts/setup-hooks.sh (from dev, once per clone)
gh auth status                          # gh must be logged in for the run gates
```

Decide the version from the commits since the last tag: new feature → minor, fixes only → patch.

## 1. Bump the version by hand, then push dev once

Bump *before* pushing, so the one CI run on `dev` covers the commit that ships. `npm version` is broken in this repo: it fails after already writing the bumped version, so a retry double-bumps. Never run it. Patch both files:

```bash
npm pkg set version=X.Y.Z
node -e 'const fs=require("fs"),p="package-lock.json",j=JSON.parse(fs.readFileSync(p,"utf8"));j.version="X.Y.Z";if(j.packages&&j.packages[""])j.packages[""].version="X.Y.Z";fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n")'
git commit -am "🔖 RELEASE - bump the version to X.Y.Z"
git push origin dev
RUN=$(gh run list --branch dev --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --exit-status --interval 30
```

`--exit-status` is the gate — a non-zero exit means stop and fix, never continue. Run the watch in the background (`run_in_background`) and prepare step 2's commands meanwhile; nothing on `main` is pushed until it is green. If a botched attempt left a wrong version: `git checkout -- package.json package-lock.json`.

## 2. Merge into main

```bash
git switch main && git pull --ff-only origin main
git mergeclean dev
```

**Conflicts here are normal, not a warning sign.** `main`'s history is a filtered replay, so the merge base is stale and every file both branches touched conflicts. `main` has no commits of its own, so `dev` is always the winner:

```bash
git checkout dev -- <each conflicted path>
grep -rn '<<<<<<<' --exclude-dir=.git --exclude-dir=node_modules .   # must print nothing
ls -a | grep -E '^\.claude|^CLAUDE.md|^\.githooks|^scripts|^\.mergeexclude'  # must print nothing
git commit --no-edit
git commit --amend -m "🔀 MAIN - merge dev without the excluded local paths"
```

The amend is required: a conflicted merge finishes through `git commit`, which loses the alias's message and writes the default `Merge branch 'dev'`.

Prove the merge resolution is sound by comparing trees, not by re-running the suite: `main` must equal `dev` except for the excluded paths, which means it is the very code CI just passed.

```bash
git diff --name-only dev HEAD | grep -vE '^(\.claude/|CLAUDE\.md$|\.githooks/|scripts/|\.mergeexclude$)'   # must print nothing
SKIP_VISUAL=1 git push origin main
```

`SKIP_VISUAL=1` because the pre-push hook would rebuild and screenshot a tree whose baselines CI has just checked on `dev`. Any path the `grep` prints is a bad resolution — fix it with `git checkout dev -- <path>` and amend, never push it. Don't wait for `main`'s CI here: step 3's workflow waits for it.

## 3. Tag and gate on the Release workflow

```bash
git tag -a vX.Y.Z -m "🔖 RELEASE - vX.Y.Z"
git push origin vX.Y.Z
gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status --interval 30
```

The workflow first waits for CI's `verify` check on the tagged commit (that is `main`'s run from step 2, usually still going), then checks the tag against `package.json`, builds both editions multi-arch, signs them with cosign, and creates the GitHub release. Run the watch in the background too.

If it stops at "Wait for CI on the tagged commit", `main`'s CI failed: nothing was published, but the tag is public. Read the CI log, fix on `dev`, and delete the tag before re-releasing: `git push --delete origin vX.Y.Z && git tag -d vX.Y.Z`.

## 4. Prove the release is published

```bash
gh release view vX.Y.Z --json tagName,isDraft,url
for t in light-vX.Y.Z ui-vX.Y.Z light-latest ui-latest; do
  printf '%-16s ' "$t"; docker manifest inspect ghcr.io/devmanfre/isitdown:$t >/dev/null 2>&1 && echo OK || echo FAIL
done
```

Image tags are `light-v1.3.0` / `ui-v1.3.0` — with the `v`, unlike the bare version in `package.json`.

The release also carries the single-file Light edition (roadmap 6.7), built by
the same workflow and attached to the GitHub release:

```bash
gh release view vX.Y.Z --json assets --jq '.assets[].name'
# expect isitdown-light-vX.Y.Z-linux-x64 and its .sha256
```

A release with images but no binary means `npm run build:sea` failed on the
runner — read that step's log rather than re-tagging.

## Quick reference

| Gate | Command | Green means |
|---|---|---|
| dev CI (after bump) | `gh run watch <id> --exit-status` | the commit that ships compiles, tests pass |
| Merge | `git diff --name-only dev HEAD` filtered | `main` is the tree CI just passed |
| Release | `gh run watch <id> --exit-status` | `main`'s CI green, images pushed, release created |
| Published | `gh release view` + `docker manifest inspect` | operators can pull it |

## Common mistakes

- Reporting a release as published without checking the binary asset as well as the two image tags.
- Pushing `main` when the tree comparison printed a path — that is the one case where `main` is not the code CI passed.
- Re-running `npm test` / `preversion` locally "to be safe" — CI runs a superset of it a minute later; this is what made a release take half an hour.
- Running `npm version` — see step 1.
- `git merge dev` on `main` — the guard hook aborts it; use `git mergeclean dev`.
- Treating mergeclean conflicts as a problem to debug instead of the expected outcome.
- Leaving the default `Merge branch 'dev'` message after a conflicted merge.
- Editing `.claude/`, `CLAUDE.md`, or `scripts/` while on `main` — they exist only on `dev`.
- Adding a Claude co-author trailer to any of these commits — banned; see `git-commit-style`.
