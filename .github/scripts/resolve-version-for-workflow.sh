#!/usr/bin/env bash
set -euo pipefail

OUTPUT_FILE="$1"
INPUT_VERSION="${2:-}"

if [ -n "$INPUT_VERSION" ]; then
  # Accept both 5.3.0 and v5.3.0 from workflow_dispatch / workflow_call.
  VERSION="${INPUT_VERSION#v}"
  echo "version=$VERSION" >> "$OUTPUT_FILE"
else
  VERSION="${GITHUB_REF_NAME#v}"
  echo "version=$VERSION" >> "$OUTPUT_FILE"
fi
