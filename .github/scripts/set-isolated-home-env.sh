#!/usr/bin/env bash
set -euo pipefail

BASE_HOME="${1:-}"
SET_HOME="${2:-false}"

if [ -z "$BASE_HOME" ]; then
  echo "Usage: set-isolated-home-env.sh <base_home>"
  exit 1
fi

mkdir -p "$BASE_HOME"

{
  if [ "$SET_HOME" = "true" ]; then
    echo "HOME=$BASE_HOME"
  fi
  echo "AX_CODE_TEST_HOME=$BASE_HOME"
  echo "XDG_CONFIG_HOME=$BASE_HOME/.config"
  echo "XDG_CACHE_HOME=$BASE_HOME/.cache"
  echo "XDG_DATA_HOME=$BASE_HOME/.local/share"
  echo "XDG_STATE_HOME=$BASE_HOME/.local/state"
} >> "$GITHUB_ENV"
