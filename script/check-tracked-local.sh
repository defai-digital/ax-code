#!/usr/bin/env sh
set -eu

# Use the staged policy. User-level excludes and unstaged edits do not affect it.
rules=$(mktemp)
trap 'rm -f "$rules"' EXIT
git show :.gitignore > "$rules"
tracked=$(git ls-files --cached --ignored --exclude-from="$rules")
if [ -n "$tracked" ]; then
  echo "ERROR: Repository-ignored paths are tracked:"
  printf '%s\n' "$tracked"
  echo "Untrack them with git rm --cached -- <path>."
  exit 1
fi
