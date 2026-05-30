#!/usr/bin/env bash
set -euo pipefail

VERSION="$1"
CHANNEL="$2"

if ! [[ "$VERSION" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z-]+)*$ ]]; then
  echo "FAIL: version must be semver (e.g. 5.2.0 or v5.2.0), got '$VERSION'"
  exit 1
fi

case "$CHANNEL" in
  all|curl|homebrew|windows) ;;
  *)
    echo "FAIL: channel must be one of [all, curl, homebrew, windows], got '$CHANNEL'"
    exit 1
    ;;
esac
