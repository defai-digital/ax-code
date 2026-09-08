import { WINDOWS_UTF8_WARNING } from "./source-launcher"

export const NODE_LAUNCH_ARGS = "--experimental-ffi --disable-warning=ExperimentalWarning"

export function windowsNodeLauncherScript() {
  // Keep exit /b outside parenthesized blocks: cmd expands %ERRORLEVEL%
  // when reading the block, before Node has run, masking the real exit code.
  return [
    "@echo off",
    "setlocal DisableDelayedExpansion",
    'set "ERRORLEVEL="',
    'set "AX_CODE_ORIGINAL_CWD=%CD%"',
    WINDOWS_UTF8_WARNING.trimEnd(),
    "if defined AX_CODE_SYSTEM_NODE goto system_node",
    'if not exist "%~dp0..\\node\\bin\\node.exe" goto system_node',
    `"%~dp0..\\node\\bin\\node.exe" ${NODE_LAUNCH_ARGS} "%~dp0..\\lib\\index-node-tui.js" %*`,
    "exit /b %ERRORLEVEL%",
    ":system_node",
    `node ${NODE_LAUNCH_ARGS} "%~dp0..\\lib\\index-node-tui.js" %*`,
    "exit /b %ERRORLEVEL%",
    "",
  ]
    .join("\n")
    .replaceAll("\n", "\r\n")
}

// Resolve a Node binary, hardlink it as AX-Code, and exec that path so the
// TTY job name is AX-Code instead of node (Apple Terminal / iTerm).
export const UNIX_BRAND_AND_EXEC_NODE = `brand_and_exec_node() {
  node_bin="$1"
  shift
  real="$node_bin"
  while [ -L "$real" ]; do
    link="$(readlink "$real")"
    case "$link" in
      /*) real="$link" ;;
      *) real="$(dirname "$real")/$link" ;;
    esac
  done
  real_dir="$(CDPATH= cd -- "$(dirname -- "$real")" && pwd -P)"
  real="$real_dir/$(basename "$real")"
  cache="\${XDG_CACHE_HOME:-\$HOME/.cache}/ax-code/libexec/runtime"
  mkdir -p "\$cache/bin" "\$cache/lib"
  branded="\$cache/bin/AX-Code"
  ln -f "$real" "$branded" 2>/dev/null || cp "$real" "$branded" 2>/dev/null || branded="$node_bin"
  src_lib="\$real_dir/../lib"
  if [ -d "\$src_lib" ] && [ "\$cache/lib" != "\$src_lib" ]; then
    for lib in "\$src_lib"/libnode*; do
      [ -e "\$lib" ] || continue
      ln -sf "\$lib" "\$cache/lib/$(basename "\$lib")" 2>/dev/null || true
    done
  fi
  exec "$branded" ${NODE_LAUNCH_ARGS} "$@"
}`

export function unixNodeLauncherScript() {
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
    UNIX_BRAND_AND_EXEC_NODE,
    'if [ -z "$AX_CODE_SYSTEM_NODE" ] && [ -x "$dir/../node/bin/node" ]; then',
    '  brand_and_exec_node "$dir/../node/bin/node" "$dir/../lib/index-node-tui.js" "$@"',
    "fi",
    'if [ -z "$AX_CODE_SYSTEM_NODE" ] && [ -x "$dir/../node/bin/node.exe" ]; then',
    `  exec "$dir/../node/bin/node.exe" ${NODE_LAUNCH_ARGS} "$dir/../lib/index-node-tui.js" "$@"`,
    "fi",
    'brand_and_exec_node "$(command -v node)" "$dir/../lib/index-node-tui.js" "$@"',
    "",
  ].join("\n")
}
