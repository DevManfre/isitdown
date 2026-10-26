---
name: release-flow
description: Ship IsItDown from dev to a published release — push dev, wait for CI, bump the version, mergeclean dev into a release branch and land it on main through a pull request, tag, and wait for the Release workflow to publish the GHCR images and the GitHub release. Use whenever the user asks to release, cut a version, publish a new version, ship to main, merge dev into main, or push a tag.
---

# Release Flow

One release = two CI waits, not four. CI runs once on `dev` *with the version already bumped*; `main` then receives the same tree, so its own CI run is a formality the Release workflow waits on by itself (its first step blocks until CI's `verify` check on the tagged commit is green and stops the release otherwise). The one extra wait is the pull request's own `verify` check in step 2, which the `main protection` ruleset requires before the PR can merge. Images and the GitHub release are public and effectively irreversible, so that gate is never skipped — it just isn't babysat by hand twice.

Don't re-run locally what CI is about to run: no `npm run preversion`, no `npm ci && npm test` after the merge. Every check below that replaces a test run proves the code is *identical* to code CI already passed.

Branch model: `main` carries only the product, `dev` carries the product *plus* `.claude/`, `CLAUDE.md`, `.mergeexclude`, `.githooks/`, `scripts/`. Every merge into `main` is a real merge whose second parent is `dev`, with the excluded paths dropped from it — so merges are always `git mergeclean dev`, never `git merge dev`; guard hooks abort a plain merge.

**`main` is the default branch and only moves through a pull request.** GitHub's contribution graph counts a commit only once it reaches the default branch, and `dev`'s commits pushed there by a local merge mostly go uncounted. So the mergeclean merge is made on a throwaway `release/vX.Y.Z` branch and that branch lands on `main` through a PR merged on GitHub — never `git push origin main`. The PR's head cannot be `dev` itself: GitHub's server-side merge has no exclude filter and would carry `.claude/`, `CLAUDE.md` and `scripts/` onto `main`.

- `gh pr merge --merge` only. **`--squash` and `--rebase` are forbidden on `main`**, even though the repo allows them: one collapses `dev`'s commits into a single new one, the other rewrites them, and either way the originals never reach `main` and never count. If the repo ever stops allowing merge commits, stop and tell the user — don't fall back to another mode.
- Never rewrite history that is already pushed (no amend, rebase or force-push of a pushed commit — the `main protection` ruleset blocks non-fast-forward on `main` anyway), and never change the author email in the middle of the work: a commit counts only under an email verified on the account.
- Don't bypass the ruleset with `gh pr merge --admin`: the PR merge waits for its own `verify` check.

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
git push origin dev:dev
RUN=$(gh run list --branch dev --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --exit-status --interval 30
```

`--exit-status` is the gate — a non-zero exit means stop and fix, never continue. Run the watch in the background (`run_in_background`) and prepare step 2's commands meanwhile; nothing on `main` is pushed until it is green. If a botched attempt left a wrong version: `git checkout -- package.json package-lock.json`.

## 2. Merge into main through a pull request

Make the mergeclean merge on a release branch cut from `main`:

```bash
git switch main && git pull --ff-only origin main
git switch -c release/vX.Y.Z
git mergeclean dev
```

**A conflict means stop.** `main`'s merges all have `dev` as their second parent, so the merge base is the previous release and the only expected collisions are the excluded paths, which mergeclean resolves by itself. Anything it prints under "conflicts left for you to resolve" is unexpected: don't resolve it on your own initiative — report the paths and `git diff` of each to the user, and leave the merge in progress (`git merge --abort` only if they say so).

When the merge commits cleanly, fix its message (the alias names it after the current branch, `RELEASE/VX.Y.Z`) — it is not pushed yet, so this is not a rewrite of pushed history:

```bash
git commit --amend -m "🔀 MAIN - merge dev without the excluded local paths"
```

Prove the merge is sound by comparing trees, not by re-running the suite: the release branch must equal `dev` except for the excluded paths, which means it is the very code CI just passed.

```bash
git diff --name-only dev HEAD | grep -vE '^(\.claude/|CLAUDE\.md$|\.githooks/|scripts/|\.mergeexclude$)'   # must print nothing
ls -a | grep -E '^\.claude|^CLAUDE.md|^\.githooks|^scripts|^\.mergeexclude'  # must print nothing
```

Any path the first `grep` prints is a bad merge — stop and report it, never push it.

Push the branch under an explicit name, open the PR, wait for its `verify` check (the `main protection` ruleset requires it), then merge it with a merge commit:

```bash
SKIP_VISUAL=1 git push origin release/vX.Y.Z:release/vX.Y.Z
gh pr create --base main --head release/vX.Y.Z \
  --title "🔀 MAIN - release vX.Y.Z" \
  --body "Merge dev into main for vX.Y.Z, without the excluded local paths."
PR=$(gh pr view release/vX.Y.Z --json number -q .number)
gh pr checks "$PR" --watch --fail-fast --interval 30
gh pr merge "$PR" --merge --delete-branch \
  --subject "🔀 MAIN - merge release vX.Y.Z (#$PR)" --body ""
git switch main && git pull --ff-only origin main
```

`SKIP_VISUAL=1` because the pre-push hook would rebuild and screenshot a tree whose baselines CI has just checked on `dev`. Run the `gh pr checks` watch in the background like the others; a failing check means stop, not `--admin`. The PR title and the merge subject follow `git-commit-style`; the body carries no Claude attribution. The merge itself pushes `main`, so there is no separate `git push origin main`; `--delete-branch` removes the release branch on both sides, and the `pull` brings the merge commit down for the tag. Don't wait for `main`'s CI here: step 3's workflow waits for it.

## 3. Tag and gate on the Release workflow

```bash
git tag -a vX.Y.Z origin/main -m "🔖 RELEASE - vX.Y.Z"
git push origin vX.Y.Z
gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status --interval 30
```

The workflow first waits for CI's `verify` check on the tagged commit (that is the `push` run on `main` that the PR merge triggered, usually still going), then checks the tag against `package.json`, builds both editions multi-arch, signs them with cosign, and creates the GitHub release. Run the watch in the background too.

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
| Merge | `git diff --name-only dev HEAD` filtered | the release branch is the tree CI just passed |
| PR | `gh pr checks <n> --watch --fail-fast` | the ruleset lets the PR merge |
| Release | `gh run watch <id> --exit-status` | `main`'s CI green, images pushed, release created |
| Published | `gh release view` + `docker manifest inspect` | operators can pull it |

## Common mistakes

- Reporting a release as published without checking the binary asset as well as the two image tags.
- Pushing the release branch when the tree comparison printed a path — that is the one case where `main` would not be the code CI passed.
- `git push origin main`, or `gh pr create --head dev` — the first keeps `dev`'s commits off the contribution graph, the second carries the excluded paths onto `main`.
- `gh pr merge --squash` / `--rebase`, or `--admin` to skip the PR's `verify` check.
- Re-running `npm test` / `preversion` locally "to be safe" — CI runs a superset of it a minute later; this is what made a release take half an hour.
- Running `npm version` — see step 1.
- `git merge dev` on `main` — the guard hook aborts it; use `git mergeclean dev`.
- Resolving a mergeclean conflict on your own — stop and report it.
- Leaving the alias's `RELEASE/VX.Y.Z` message on the merge commit.
- Editing `.claude/`, `CLAUDE.md`, or `scripts/` while on `main` — they exist only on `dev`.
- Adding a Claude co-author trailer to any of these commits — banned; see `git-commit-style`.
