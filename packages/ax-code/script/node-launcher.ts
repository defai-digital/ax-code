export function unixNodeLauncherScript() {
  const nodeArgs = "--experimental-ffi --disable-warning=ExperimentalWarning"
  return [
    "#!/bin/sh",
    'script="$0"',
    'while [ -L "$script" ]; do',
    '  target="$(readlink "$script")"',
    '  case "$target" in',
    '    /*) script="$target" ;;',
    '    *) script="$(dirname "$script")/$target" ;;',
    "  esac",
    "done",
    'dir="$(CDPATH= cd -- "$(dirname -- "$script")" && pwd -P)"',
    'if [ -z "$AX_CODE_SYSTEM_NODE" ] && [ -x "$dir/../node/bin/node" ]; then',
    `  exec "$dir/../node/bin/node" ${nodeArgs} "$dir/../lib/index-node-tui.js" "$@"`,
    "fi",
    'if [ -z "$AX_CODE_SYSTEM_NODE" ] && [ -x "$dir/../node/bin/node.exe" ]; then',
    `  exec "$dir/../node/bin/node.exe" ${nodeArgs} "$dir/../lib/index-node-tui.js" "$@"`,
    "fi",
    `exec node ${nodeArgs} "$dir/../lib/index-node-tui.js" "$@"`,
    "",
  ].join("\n")
}
