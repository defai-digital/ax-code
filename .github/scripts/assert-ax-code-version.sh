#!/usr/bin/env bash
set -euo pipefail

EXPECTED_VERSION="${1:-}"
if [ -z "$EXPECTED_VERSION" ]; then
  echo "Usage: assert-ax-code-version.sh <expected_version>"
  exit 1
fi

OUTPUT="$(ax-code --version)"
echo "$OUTPUT"
if [ "$OUTPUT" != "$EXPECTED_VERSION" ] && [ "$OUTPUT" != "v$EXPECTED_VERSION" ]; then
  echo "FAIL: expected ax-code --version to be ${EXPECTED_VERSION}, got ${OUTPUT}"
  exit 1
fi
