#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git build-essential python3 clang libclang-dev pkg-config cmake unzip xz-utils zip
cd /work
printf '%s  source.tar.gz\n' "$SOURCE_SHA256" | sha256sum -c -
mkdir -p source
tar xzf source.tar.gz -C source
cd source
case "$(uname -m)" in x86_64) target_arch=x64;; aarch64) target_arch=arm64;; *) exit 1;; esac
node_archive="node-v26.5.1-linux-${target_arch}.tar.xz"
curl -fsSLO "https://nodejs.org/dist/v26.5.1/${node_archive}"
curl -fsSLO https://nodejs.org/dist/v26.5.1/SHASUMS256.txt
awk -v file="$node_archive" '$2 == file { print }' SHASUMS256.txt | sha256sum -c -
mkdir -p /opt/ax-release-node
tar xJf "$node_archive" --strip-components=1 -C /opt/ax-release-node
export PATH="/opt/ax-release-node/bin:/root/.cargo/bin:$PATH"
npm install -g pnpm@10.33.4
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
export CARGO_BUILD_JOBS=2
export CARGO_TARGET_DIR=/cache/target
export AX_CODE_DISABLE_AUTOUPDATE=1 AX_CODE_DISABLE_AUTO_INDEX=1 AX_CODE_DISABLE_LSP_DOWNLOAD=1 AX_CODE_DISABLE_MODELS_FETCH=1 AX_CODE_DISABLE_PROJECT_CONFIG=1
export AX_CODE_TEST_HOME=/work/test-home XDG_CONFIG_HOME=/work/test-home/.config XDG_CACHE_HOME=/work/test-home/.cache XDG_DATA_HOME=/work/test-home/.local/share XDG_STATE_HOME=/work/test-home/.local/state
node --version
pnpm --version
rustc --version
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec vitest run script/install-unix.test.ts
pnpm build:native fs
node script/verify-evidence-cache.cjs packages/ax-code-fs-native
pnpm build:native index-core diff parser
pnpm --dir packages/sdk/js exec tsc
pnpm --dir packages/plugin run build
AX_CODE_VERSION="$VERSION" AX_CODE_CHANNEL=latest AX_CODE_RELEASE=true pnpm --dir packages/ax-code exec tsx script/build-node-tui.ts --release --arch "$target_arch"
node script/verify-typescript-native.cjs "packages/ax-code/dist/ax-code-linux-${target_arch}"
mkdir -p /work/relocated
cp -a "packages/ax-code/dist/ax-code-linux-${target_arch}/." /work/relocated/
/work/relocated/bin/ax-code --version | tee /work/version.txt
grep -Fx "$VERSION" /work/version.txt
/work/relocated/bin/ax-code doctor | tee /work/doctor.txt
grep -F 'Native addons: 4/4 installed' /work/doctor.txt
grep -E 'Runtime: .* \(node-bundled\)' /work/doctor.txt
sha256sum "packages/ax-code/dist/ax-code-linux-${target_arch}.tar.gz" | tee /work/archive.sha256
printf 'candidate_sha=%s\nsource_sha256=%s\nplatform=linux-%s\nstatus=passed\n' "$CANDIDATE" "$SOURCE_SHA256" "$target_arch" > /work/build-receipt.txt

cd /work/source
arch="$(/opt/ax-release-node/bin/node -p process.arch)"
runtime="/work/relocated"
export AX_CODE_TEST_HOME=/work/qualification-home
export XDG_CONFIG_HOME=/work/qualification-home/.config XDG_CACHE_HOME=/work/qualification-home/.cache XDG_DATA_HOME=/work/qualification-home/.local/share XDG_STATE_HOME=/work/qualification-home/.local/state
export AX_CODE_DISABLE_PROJECT_CONFIG=1 AX_CODE_DISABLE_MODELS_FETCH=1 AX_CODE_DISABLE_AUTO_INDEX=1 AX_CODE_DISABLE_AUTOUPDATE=1 AX_CODE_DISABLE_LSP_DOWNLOAD=1
printf '{"type":"rpc.request","method":"health","id":1}\n' | "$runtime/bin/ax-code" tui-backend --stdio > /work/backend.txt 2>&1
grep -E '"type":"rpc.result".*"id":1' /work/backend.txt
cat /work/backend.txt | bash .github/scripts/assert-runtime-mode.sh linux backend
"$runtime/node/bin/node" script/verify-pty.cjs "$runtime/node_modules/node-pty-prebuilt-multiarch" > /work/pty.json
"$runtime/node/bin/node" script/verify-typescript-native.cjs "$runtime" > /work/typescript-native.json
python3 - "$arch" <<'PY'
import hashlib,json,os,sys
from pathlib import Path
p=Path('/work');arch=sys.argv[1]
assert json.loads((p/'pty.json').read_text())['verified']
assert json.loads((p/'typescript-native.json').read_text())['verified']
assert 'Native addons: 4/4 installed' in (p/'doctor.txt').read_text()
assert (p/'version.txt').read_text().strip()==os.environ['VERSION']
receipt=dict(line.split('=',1) for line in (p/'build-receipt.txt').read_text().splitlines())
assert receipt['candidate_sha']==os.environ['CANDIDATE']
d={'candidate':receipt['candidate_sha'],'version':os.environ['VERSION'],'platform':'linux-'+arch,'status':'passed','native_addons':4,'pty_verified':True,'backend_verified':True,'typescript_native_verified':True,'source_sha256':receipt['source_sha256']}
d['archive_sha256']=hashlib.sha256((p/('source/packages/ax-code/dist/ax-code-linux-'+arch+'.tar.gz')).read_bytes()).hexdigest()
(p/('linux-'+arch+'-qualification.json')).write_text(json.dumps(d,indent=2)+'\n')
PY
