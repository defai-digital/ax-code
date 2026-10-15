#!/usr/bin/env bash
set -euo pipefail
version="$1"
lane="$2"
work="$3"
repo="$4"
mkdir -p "$work"
export AX_CODE_TEST_HOME="$work/test-home" XDG_CONFIG_HOME="$work/test-home/.config" XDG_DATA_HOME="$work/test-home/.local/share" XDG_CACHE_HOME="$work/test-home/.cache" XDG_STATE_HOME="$work/test-home/.local/state"
export AX_CODE_INSTALL_ENGINE=0
export AX_CODE_DISABLE_AUTOUPDATE=1 AX_CODE_DISABLE_AUTO_INDEX=1 AX_CODE_DISABLE_PROJECT_CONFIG=1 AX_CODE_DISABLE_LSP_DOWNLOAD=1 AX_CODE_DISABLE_MODELS_FETCH=1
installer="$work/install"
base="https://download.ax-code.com/releases/download/v${version}"
curl -fsSL --retry 3 "$base/install" -o "$installer"
curl -fsSL --retry 3 "$base/install.sha256" -o "$installer.sha256"
python3 - "$installer" <<'PY'
import hashlib,sys
from pathlib import Path
p=Path(sys.argv[1]);assert hashlib.sha256(p.read_bytes()).hexdigest()==Path(str(p)+'.sha256').read_text().split()[0]
PY
previous="$work/previous-install"
restore=false
if [[ -e "$HOME/.ax-code" ]]; then
  [[ ! -e "$previous" ]] || { echo 'Previous-install snapshot already exists; refusing overwrite'; exit 1; }
  if pgrep -f "$HOME/.ax-code/.*(node|ax-code|index-node)" >/dev/null; then
    echo 'Existing standalone runtime is busy; refusing to replace it for fresh qualification'
    exit 1
  fi
  mv "$HOME/.ax-code" "$previous"
  restore=true
fi
restore_install() {
  if [[ "$restore" == true ]]; then
    [[ ! -e "$work/qualified-install" ]] || return 1
    if [[ -e "$HOME/.ax-code" ]]; then
      mv "$HOME/.ax-code" "$work/qualified-install" || return 1
    fi
    mv "$previous" "$HOME/.ax-code"
  fi
}
trap restore_install EXIT
SHELL=/bin/bash bash "$installer" --version "$version" --no-modify-path > "$work/installer.log" 2>&1
launcher="$HOME/.ax-code/bin/ax-code"
[[ "$("$launcher" --version)" == "$version" ]]
"$launcher" doctor > "$work/doctor.txt" 2>&1
grep -F 'Native addons: 4/4 installed' "$work/doctor.txt"
cat "$work/doctor.txt" | bash "$repo/.github/scripts/assert-runtime-mode.sh" "$lane" doctor
printf '{"type":"rpc.request","method":"health","id":1}\n' | "$launcher" tui-backend --stdio > "$work/backend.txt" 2>&1
grep -E '"type":"rpc.result".*"id":1' "$work/backend.txt"
cat "$work/backend.txt" | bash "$repo/.github/scripts/assert-runtime-mode.sh" "$lane" backend
runtime="$(dirname "$(dirname "$(readlink "$launcher")")")"
"$runtime/node/bin/node" "$repo/script/verify-pty.cjs" "$runtime/node_modules/node-pty-prebuilt-multiarch" > "$work/pty.json"
python3 - "$version" "$lane" "$work" <<'PY'
import json,sys
from pathlib import Path
version,lane,work=sys.argv[1:];p=Path(work)
assert json.loads((p/'pty.json').read_text())['verified']
r={'version':version,'lane':lane,'status':'passed','fresh_install':True,'backend_verified':True,'pty_verified':True,'native_addons':4,'origin':'https://download.ax-code.com'}
(p/('install-'+lane+'.json')).write_text(json.dumps(r,indent=2)+'\n')
PY
