#!/usr/bin/env bash
# Compatibility wrapper. Prefer script/dogfood-native-tui.sh.
#
# The old OpenTUI N-API renderer and --yoga scope no longer exist. This path is
# kept so maintainer notes and shell aliases keep working.

set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dogfood-native-tui.sh" "$@"
