#!/usr/bin/env bash
set -euo pipefail

OUTPUT_FILE="$1"
INPUT_VERSION="${2:-}"

if [ -n "$INPUT_VERSION" ]; then
  echo "version=$INPUT_VERSION" >> "$OUTPUT_FILE"
else
  VERSION="${GITHUB_REF_NAME#v}"
  echo "version=$VERSION" >> "$OUTPUT_FILE"
fi
