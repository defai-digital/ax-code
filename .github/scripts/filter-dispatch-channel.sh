#!/usr/bin/env bash
set -euo pipefail

OUTPUT_FILE="$1"
REQUESTED_CHANNEL="${2:-}"
CURRENT_CHANNEL="${3:-}"
DISPLAY_LABEL="${4:-$CURRENT_CHANNEL}"

if [ -z "$REQUESTED_CHANNEL" ] || [ "$REQUESTED_CHANNEL" = "both" ] || [ "$REQUESTED_CHANNEL" = "$CURRENT_CHANNEL" ]; then
  echo "enabled=true" >> "$OUTPUT_FILE"
else
  echo "Skipping ${DISPLAY_LABEL} (workflow_dispatch requested ${REQUESTED_CHANNEL})" \
    || true
  echo "enabled=false" >> "$OUTPUT_FILE"
fi
