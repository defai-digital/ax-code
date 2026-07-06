#!/usr/bin/env bash
set -euo pipefail

CHANNEL="${1:-}"
MODE="${2:-doctor}"

if [ -z "$CHANNEL" ] || [ -z "$MODE" ]; then
  echo "Usage: assert-runtime-mode.sh <channel> <mode>"
  exit 1
fi

LABEL="${3:-$CHANNEL}"
CHECK_LABEL="${LABEL}"

if [ "$CHANNEL" = "source" ]; then
  # Source launcher runs on Node.js (Bun was removed from the project).
  RUNTIME_NAME="Node"
  RUNTIME_RE='source'
else
  # Homebrew/Windows ship the node-bundled distribution.
  RUNTIME_NAME="Node"
  RUNTIME_RE='node-bundled'
fi

case "$MODE" in
  doctor)
    PATTERN="Runtime: ${RUNTIME_NAME} .* \\(${RUNTIME_RE}\\)"
    CHECK_LABEL="runtimeMode"
    ;;
  backend)
    PATTERN="\"runtimeMode\":\"${RUNTIME_RE}\""
    CHECK_LABEL="backend runtimeMode"
    ;;
  *)
    echo "FAIL: unknown mode '${MODE}'"
    exit 1
    ;;
esac

OUTPUT="$(cat)"
if [ -z "$OUTPUT" ]; then
  echo "FAIL: empty command output for ${LABEL} check"
  exit 1
fi

if ! echo "$OUTPUT" | grep -E "$PATTERN" >/dev/null 2>&1; then
  echo "FAIL: ${LABEL} did not report ${RUNTIME_RE} ${CHECK_LABEL}"
  exit 1
fi
