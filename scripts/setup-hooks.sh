#!/usr/bin/env sh
#
# One-time setup after cloning. Git never runs hooks straight from a clone, so
# this has to be enabled by hand once per clone.
#
set -e
top=$(git rev-parse --show-toplevel)
cd "$top"

chmod +x .githooks/* scripts/git-merge-clean scripts/setup-hooks.sh 2>/dev/null || true

git config core.hooksPath .githooks
git config mergeclean.purgeFrom dev
git config alias.mergeclean '!f() { MERGECLEAN_MESSAGE="🔀 $(git rev-parse --abbrev-ref HEAD | tr "[:lower:]" "[:upper:]") - merge $1 without the excluded local paths" "$(git rev-parse --show-toplevel)/scripts/git-merge-clean" "$@"; }; f'

printf '%s\n' \
  "hooks path       : $(git config core.hooksPath)" \
  "purge reference  : $(git config mergeclean.purgeFrom)" \
  "merge alias      : git mergeclean <branch>" \
  "excluded paths   : $(grep -vE '^\s*(#|$)' .mergeexclude | tr '\n' ' ')"
