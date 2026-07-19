#!/usr/bin/env bash
#
# Generate the local minisign keypair used for AX Code Desktop release artifacts.

set -euo pipefail

KEY_DIR="${SIGNKEY_DIR:-$HOME/signkey}"
SECRET_KEY="${AX_CODE_DESKTOP_MINISIGN_SECRET_KEY:-${MINISIGN_SECRET_KEY:-}}"
PUBLIC_KEY="${AX_CODE_DESKTOP_MINISIGN_PUBLIC_KEY:-${MINISIGN_PUBLIC_KEY:-}}"
CREATE_SECRET_KEY_ALIAS=false
FORCE=false
NO_PASSWORD=false
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: ./scripts/minisign-keygen.sh [options]

Generate the minisign keypair for signing AX Code Desktop release artifacts.

Options:
  --key-dir <path>          Directory for generated keys (default: ~/signkey)
  --secret-key <path>       Secret key path (default: <key-dir>/ax.minisign.key,
                            backed by <key-dir>/ax.sec)
  --public-key <path>       Public key path (default: <key-dir>/ax.pub)
  --force                   Overwrite an existing keypair
  --allow-unencrypted-test-key
                            Generate an unencrypted secret key for short-lived
                            tests (alias: --no-password)
  --dry-run                 Print what would be done
  -h, --help                Show this help

Environment:
  SIGNKEY_DIR                                Directory for generated keys.
  AX_CODE_DESKTOP_MINISIGN_SECRET_KEY        Overrides the default secret key path.
  MINISIGN_SECRET_KEY                        Fallback secret key path override.
  AX_CODE_DESKTOP_MINISIGN_PUBLIC_KEY        Overrides the default public key path.
  MINISIGN_PUBLIC_KEY                        Fallback public key path override.
EOF
}

# Portable permission mode: stat -f (BSD/macOS) then stat -c (GNU/Linux).
path_mode() {
  local path="$1"
  stat -f '%Lp' "$path" 2>/dev/null || stat -c '%a' "$path" 2>/dev/null || true
}

require_private_path() {
  local path="$1"
  local label="$2"
  local mode

  mode="$(path_mode "$path")"
  if [[ -z "$mode" ]]; then
    echo "error: could not inspect permissions for $label: $path" >&2
    exit 1
  fi
  if (( 8#$mode & 8#077 )); then
    echo "error: $label must not be group/world accessible: $path has mode $mode" >&2
    echo "       run: chmod 600 '$path'" >&2
    exit 1
  fi
}

public_key_id() {
  [[ -f "$PUBLIC_KEY" ]] || return 0
  awk '/^untrusted comment: minisign public key / { print $NF; exit }' "$PUBLIC_KEY"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --key-dir)
      shift
      [[ -n "${1:-}" ]] || { echo "error: --key-dir requires an argument" >&2; exit 1; }
      KEY_DIR="$1"
      ;;
    --secret-key)
      shift
      [[ -n "${1:-}" ]] || { echo "error: --secret-key requires an argument" >&2; exit 1; }
      SECRET_KEY="$1"
      ;;
    --public-key)
      shift
      [[ -n "${1:-}" ]] || { echo "error: --public-key requires an argument" >&2; exit 1; }
      PUBLIC_KEY="$1"
      ;;
    --force)
      FORCE=true
      ;;
    --allow-unencrypted-test-key|--no-password)
      NO_PASSWORD=true
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      echo "error: unexpected argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if [[ -z "$SECRET_KEY" ]]; then
  SECRET_KEY="$KEY_DIR/ax.minisign.key"
  SECRET_KEY_BACKING="$KEY_DIR/ax.sec"
  CREATE_SECRET_KEY_ALIAS=true
else
  SECRET_KEY_BACKING="$SECRET_KEY"
fi
PUBLIC_KEY="${PUBLIC_KEY:-$KEY_DIR/ax.pub}"
SECRET_KEY_DIR="$(dirname "$SECRET_KEY_BACKING")"
PUBLIC_KEY_DIR="$(dirname "$PUBLIC_KEY")"

if ! command -v minisign >/dev/null 2>&1; then
  echo "error: minisign is not installed (try: brew install minisign)" >&2
  exit 1
fi

if [[ "$FORCE" != true ]]; then
  if [[ -e "$SECRET_KEY" || -L "$SECRET_KEY" || -e "$SECRET_KEY_BACKING" || -e "$PUBLIC_KEY" ]]; then
    echo "error: refusing to overwrite an existing keypair:" >&2
    echo "       $SECRET_KEY" >&2
    if [[ "$CREATE_SECRET_KEY_ALIAS" == true ]]; then
      echo "       $SECRET_KEY_BACKING" >&2
    fi
    echo "       $PUBLIC_KEY" >&2
    echo "       pass --force only if you intentionally want to rotate the signing key" >&2
    exit 1
  fi
fi

MINISIGN_ARGS=(-G -s "$SECRET_KEY_BACKING" -p "$PUBLIC_KEY")
if [[ "$FORCE" == true ]]; then
  MINISIGN_ARGS+=(-f)
fi
if [[ "$NO_PASSWORD" == true ]]; then
  MINISIGN_ARGS+=(-W)
fi

echo "Key directory: $KEY_DIR"
echo "Secret key:    $SECRET_KEY"
if [[ "$CREATE_SECRET_KEY_ALIAS" == true ]]; then
  echo "Secret backing: $SECRET_KEY_BACKING"
fi
echo "Public key:    $PUBLIC_KEY"

if [[ "$DRY_RUN" == true ]]; then
  printf 'would ensure private secret-key directory: %s\n' "$SECRET_KEY_DIR"
  printf 'would ensure public-key directory exists: %s\n' "$PUBLIC_KEY_DIR"
  printf 'would run: minisign'
  printf ' %q' "${MINISIGN_ARGS[@]}"
  printf '\n'
  exit 0
fi

umask 077
if [[ -d "$SECRET_KEY_DIR" ]]; then
  require_private_path "$SECRET_KEY_DIR" "secret key directory"
else
  mkdir -p "$SECRET_KEY_DIR"
  chmod 700 "$SECRET_KEY_DIR"
fi
mkdir -p "$PUBLIC_KEY_DIR"

if [[ "$NO_PASSWORD" == true ]]; then
  echo "warning: generating an unencrypted test key; do not use it for releases" >&2
else
  echo "minisign will prompt for a secret-key password; keep it out of shell history and chat."
fi

minisign "${MINISIGN_ARGS[@]}"

chmod 600 "$SECRET_KEY_BACKING"
if [[ "$CREATE_SECRET_KEY_ALIAS" == true ]]; then
  if [[ -e "$SECRET_KEY" || -L "$SECRET_KEY" ]]; then
    rm -f "$SECRET_KEY"
  fi
  ln -s "$(basename "$SECRET_KEY_BACKING")" "$SECRET_KEY"
fi
chmod 644 "$PUBLIC_KEY"
require_private_path "$SECRET_KEY_DIR" "secret key directory"
require_private_path "$SECRET_KEY_BACKING" "secret key"

echo ""
echo "Generated minisign keypair."
echo "Public key id: $(public_key_id)"
echo "Publish this public key for verification:"
cat "$PUBLIC_KEY"
