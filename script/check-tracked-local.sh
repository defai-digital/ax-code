#!/usr/bin/env sh
set -eu

cd "$(git rev-parse --show-toplevel)"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
rules="$scratch/worktree"
mkdir "$rules"

# Recreate the versioned ignore hierarchy from the index. Worktree changes,
# local excludes, and global ignore files have no effect on the check.
git ls-files -z -- ':(glob)**/.gitignore' > "$scratch/paths"
git checkout-index --ignore-skip-worktree-bits --prefix="$rules/" -z --stdin < "$scratch/paths"
if [ ! -f "$rules/.gitignore" ] || [ -L "$rules/.gitignore" ]; then
  echo "ERROR: Stage a regular root .gitignore file."
  exit 1
fi
tracked=$(git --work-tree="$rules" ls-files --cached --ignored --exclude-per-directory=.gitignore)
if [ -n "$tracked" ]; then
  echo "ERROR: Repository-ignored paths are tracked:"
  printf '%s\n' "$tracked"
  echo "Untrack them with git rm --cached -- <path>."
  exit 1
fi
