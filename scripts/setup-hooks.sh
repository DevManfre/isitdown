#!/usr/bin/env sh
#
# Install the merge filter into this clone's .git directory.
#
# The filter itself is tracked on `dev` only, so it cannot be read from `main`.
# This script copies it into .git/, which every branch shares:
#
#   scripts/git-merge-clean -> .git/merge-clean
#   .githooks/*             -> .git/hooks/*
#   .mergeexclude           -> .git/merge-exclude
#
# Run it from `dev`, once per clone, and again after changing `.mergeexclude`
# or `scripts/git-merge-clean`.
#
set -e
top=$(git rev-parse --show-toplevel)
cd "$top"
gitdir=$(git rev-parse --absolute-git-dir)

if [ ! -f scripts/git-merge-clean ] || [ ! -f .mergeexclude ]; then
  echo "setup-hooks: run this from a branch that tracks scripts/ and .mergeexclude (dev)" >&2
  exit 1
fi

cp scripts/git-merge-clean "$gitdir/merge-clean"
chmod +x "$gitdir/merge-clean"

mkdir -p "$gitdir/hooks"
for hook in .githooks/*; do
  cp "$hook" "$gitdir/hooks/$(basename "$hook")"
  chmod +x "$gitdir/hooks/$(basename "$hook")"
done

cp .mergeexclude "$gitdir/merge-exclude"

# .git/hooks is the default location, so any core.hooksPath override must go
git config --unset core.hooksPath 2>/dev/null || true
git config mergeclean.purgeFrom dev
git config alias.mergeclean '!f() { MERGECLEAN_MESSAGE="🔀 $(git rev-parse --abbrev-ref HEAD | tr "[:lower:]" "[:upper:]") - merge $1 without the excluded local paths" "$(git rev-parse --absolute-git-dir)/merge-clean" "$@"; }; f'

printf '%s\n' \
  "wrapper        : \$GIT_DIR/merge-clean" \
  "hooks          : \$GIT_DIR/hooks/{post-checkout,pre-commit,pre-merge-commit}" \
  "exclude list   : \$GIT_DIR/merge-exclude" \
  "purge ref      : $(git config mergeclean.purgeFrom)" \
  "merge command  : git mergeclean <branch>" \
  "excluded paths : $(grep -vE '^[[:space:]]*(#|$)' .mergeexclude | tr '\n' ' ')"
