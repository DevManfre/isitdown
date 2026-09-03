---
name: release-flow
description: Ship IsItDown from dev to a published release — push dev, wait for CI, bump the version, merge into main with mergeclean, tag, and wait for the Release workflow to publish the GHCR images and the GitHub release. Use whenever the user asks to release, cut a version, publish a new version, ship to main, merge dev into main, or push a tag.
---

# Release Flow

One release = five gates, in order, each proven green before the next starts. Never tag a commit whose CI has not passed: `release.yml` builds and pushes public images to GHCR and creates a public GitHub release, and both are effectively irreversible.

Branch model: `main` carries only the product, `dev` carries the product *plus* `.claude/`, `CLAUDE.md`, `.mergeexclude`, `.githooks/`, `scripts/`. `main` is a filtered replay of `dev` (rewritten SHAs), so merges are always `git mergeclean dev`, never `git merge dev` — guard hooks abort a plain merge.

## Preconditions

```bash
git status -sb                          # clean tree, on dev
git config --get alias.mergeclean       # empty → scripts/setup-hooks.sh (from dev, once per clone)
gh auth status                          # gh must be logged in for the run gates
```

Decide the version from the commits since the last tag: new feature → minor, fixes only → patch.

## 1. Push dev, gate on CI

```bash
git push origin dev
RUN=$(gh run list --branch dev --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --exit-status --interval 15
```

`--exit-status` is the gate — a non-zero exit means stop and fix, never continue.

## 2. Bump the version by hand

`npm version` is broken in this repo: it fails after already writing the bumped version, so a retry double-bumps. Never run it. Run the checks yourself, then patch both files:

```bash
npm run preversion                       # typecheck + unit + integration, must exit 0
npm pkg set version=X.Y.Z
node -e 'const fs=require("fs"),p="package-lock.json",j=JSON.parse(fs.readFileSync(p,"utf8"));j.version="X.Y.Z";if(j.packages&&j.packages[""])j.packages[""].version="X.Y.Z";fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n")'
git commit -am "🔖 RELEASE - bump the version to X.Y.Z"
git push origin dev
```

Then gate on CI again (same two commands as step 1). If a botched attempt left a wrong version: `git checkout -- package.json package-lock.json`.

## 3. Merge into main

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

Verify the merge locally before publishing it, then push and gate on CI:

```bash
npm ci && npm run typecheck && npm test
git push origin main
gh run watch "$(gh run list --branch main --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status --interval 15
```

## 4. Tag and gate on the Release workflow

```bash
git tag -a vX.Y.Z -m "🔖 RELEASE - vX.Y.Z"
git push origin vX.Y.Z
gh run watch "$(gh run list --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status --interval 20
```

The workflow re-verifies, checks the tag against `package.json`, builds both editions multi-arch, signs them with cosign, and creates the GitHub release. It takes minutes, not seconds.

## 5. Prove the release is published

```bash
gh release view vX.Y.Z --json tagName,isDraft,url
for t in light-vX.Y.Z ui-vX.Y.Z light-latest ui-latest; do
  printf '%-16s ' "$t"; docker manifest inspect ghcr.io/devmanfre/isitdown:$t >/dev/null 2>&1 && echo OK || echo FAIL
done
```

Image tags are `light-v1.3.0` / `ui-v1.3.0` — with the `v`, unlike the bare version in `package.json`.

## Quick reference

| Gate | Command | Green means |
|---|---|---|
| dev CI | `gh run watch <id> --exit-status` | code compiles, tests pass |
| dev CI after bump | same | the version commit is sound |
| main CI | same | the merge resolution is sound |
| Release | same | images pushed, release created |
| Published | `gh release view` + `docker manifest inspect` | operators can pull it |

## Common mistakes

- Tagging before `main`'s CI is green — the tag is public the moment it is pushed.
- Running `npm version` — see step 2.
- `git merge dev` on `main` — the guard hook aborts it; use `git mergeclean dev`.
- Treating mergeclean conflicts as a problem to debug instead of the expected outcome.
- Leaving the default `Merge branch 'dev'` message after a conflicted merge.
- Editing `.claude/`, `CLAUDE.md`, or `scripts/` while on `main` — they exist only on `dev`.
- Adding a Claude co-author trailer to any of these commits — banned; see `git-commit-style`.
