#!/usr/bin/env bash
#
# Sign AX Code Desktop release artifacts with the local minisign keypair.
#
# Hardened signer: pinned-public-key enforcement (on by default), public-key
# string verification, signature directory, dry-run, untrusted comment, portable
# SHA-256, and a UTC timestamp in the default trusted comment. The desktop
# signing key is the default and its public key material is pinned in the script
# so the signer fails closed if the local keypair ever drifts from the expected
# release key.

set -euo pipefail

shopt -s nullglob

KEY_DIR="${SIGNKEY_DIR:-$HOME/signkey}"
SECRET_KEY="${AX_CODE_DESKTOP_MINISIGN_SECRET_KEY:-${MINISIGN_SECRET_KEY:-}}"
PUBLIC_KEY="${AX_CODE_DESKTOP_MINISIGN_PUBLIC_KEY:-${MINISIGN_PUBLIC_KEY:-}}"
PUBLIC_KEY_STRING="${AX_CODE_DESKTOP_MINISIGN_PUBLIC_KEY_STRING:-}"
PINNED_PUBLIC_KEY="${AX_CODE_DESKTOP_MINISIGN_PINNED_PUBLIC_KEY:-RWSlDu++afxCz01OqhYWhfo8+L8pVbSYXJBEb2zoWBuK0WACIzbGVZRO}"
TRUSTED_COMMENT="${AX_CODE_DESKTOP_MINISIGN_TRUSTED_COMMENT:-${MINISIGN_TRUSTED_COMMENT:-}}"
UNTRUSTED_COMMENT="${AX_CODE_DESKTOP_MINISIGN_UNTRUSTED_COMMENT:-${MINISIGN_UNTRUSTED_COMMENT:-signature from ax-code-desktop local signing key}}"
MINISIGN_KEY_PASSWORD="${AX_CODE_DESKTOP_MINISIGN_PASSWORD:-${MINISIGN_PASSWORD:-}}"
KEYCHAIN_SERVICE="${AX_CODE_DESKTOP_MINISIGN_KEYCHAIN_SERVICE:-ax-minisign}"
KEYCHAIN_ACCOUNT="${AX_CODE_DESKTOP_MINISIGN_KEYCHAIN_ACCOUNT:-ax-release}"
SIGNATURE_DIR=""
VERIFY=true
FORCE=false
DRY_RUN=false
FILES=()

usage() {
  cat <<'EOF'
Usage: ./scripts/minisign-artifacts.sh [options] [file ...]

Signs the provided files. With no files, signs conventional release artifacts
under desktop/packages/electron/dist and desktop/packages/web.

Options:
  --key-dir <path>          Directory containing keys (default: ~/signkey)
  --secret-key <path>       Secret key path (default: <key-dir>/ax.minisign.key)
  --public-key <path>       Public key path (default: <key-dir>/ax.pub)
  --public-key-string <key> Verify with a raw public key string (no file needed).
  --pinned-public-key <key> Fail unless the public key matches this key.
                             Default: AX_CODE_DESKTOP_MINISIGN_PINNED_PUBLIC_KEY
                             (hardcoded to the desktop release key, enforced).
  --signature-dir <dir>     Write all .minisig files into this directory.
  --trusted-comment <text>  Trusted minisign comment
  --untrusted-comment <text>
                            Untrusted minisign comment
  --keychain-service <svc>  macOS Keychain service name for passphrase lookup.
                             Default: ax-minisign
  --keychain-account <acct> macOS Keychain account name for passphrase lookup.
                             Default: ax-release
  --force                   Replace existing .minisig files
  --no-verify               Skip verification after signing
  --dry-run                 Print what would be signed
  --help                    Show this help

Environment:
  SIGNKEY_DIR                                Directory containing keys.
  AX_CODE_DESKTOP_MINISIGN_SECRET_KEY        Overrides the secret key path.
  MINISIGN_SECRET_KEY                        Fallback secret key path override.
  AX_CODE_DESKTOP_MINISIGN_PUBLIC_KEY        Overrides the public key path.
  MINISIGN_PUBLIC_KEY                        Fallback public key path override.
  AX_CODE_DESKTOP_MINISIGN_PUBLIC_KEY_STRING Public key string for verification.
  AX_CODE_DESKTOP_MINISIGN_PINNED_PUBLIC_KEY Expected public key; signing fails on mismatch.
  AX_CODE_DESKTOP_MINISIGN_TRUSTED_COMMENT   Default trusted comment.
  AX_CODE_DESKTOP_MINISIGN_UNTRUSTED_COMMENT Default untrusted comment.
  AX_CODE_DESKTOP_MINISIGN_PASSWORD          Key passphrase (prefer Keychain over this).
  MINISIGN_PASSWORD                          Fallback passphrase.
  AX_CODE_DESKTOP_MINISIGN_KEYCHAIN_SERVICE  Keychain service name.
  AX_CODE_DESKTOP_MINISIGN_KEYCHAIN_ACCOUNT  Keychain account name.
EOF
}

check_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: '$1' not found" >&2
    exit 1
  fi
}

# Portable permission mode: stat -f (BSD/macOS) then stat -c (GNU/Linux).
path_mode() {
  local path="$1"
  # Follow the compatibility symlink created by minisign-keygen.sh. Without
  # -L, GNU stat reports the symlink's 0777 mode and rejects a safely-permissioned
  # backing key on Linux.
  stat -L -f '%Lp' "$path" 2>/dev/null || stat -L -c '%a' "$path" 2>/dev/null || true
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

# Public key material (the RW... line) from a minisign public key file.
public_key_material() {
  [[ -f "$PUBLIC_KEY" ]] || return 0
  awk '/^RW/ { print $1; exit }' "$PUBLIC_KEY"
}

# Public key id (the hex tail of the "untrusted comment" line).
public_key_id() {
  [[ -f "$PUBLIC_KEY" ]] || return 0
  awk '/^untrusted comment: minisign public key / { print $NF; exit }' "$PUBLIC_KEY"
}

# Effective public key material: explicit string, else material read from file.
effective_public_key_material() {
  if [[ -n "$PUBLIC_KEY_STRING" ]]; then
    printf '%s\n' "$PUBLIC_KEY_STRING"
    return
  fi
  public_key_material
}

require_pinned_public_key() {
  local actual
  actual="$(effective_public_key_material)"
  if [[ -z "$actual" ]]; then
    echo "error: could not read minisign public key material for pin check" >&2
    echo "       provide --public-key <file> or --public-key-string <key>" >&2
    exit 1
  fi
  if [[ "$actual" != "$PINNED_PUBLIC_KEY" ]]; then
    echo "Minisign public key does not match the pinned AX Code Desktop release key: $PUBLIC_KEY" >&2
    echo "Expected: $PINNED_PUBLIC_KEY" >&2
    echo "Actual:   $actual" >&2
    echo "Override with --pinned-public-key only if you intentionally changed keys." >&2
    exit 1
  fi
}

# Portable SHA-256 hex digest: sha256sum (Linux) then shasum (macOS).
sha256_hex() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{ print $1 }'
  else
    shasum -a 256 "$file" | awk '{ print $1 }'
  fi
}

trusted_comment_for_file() {
  local file="$1"
  local basename
  local hash

  if [[ -n "$TRUSTED_COMMENT" ]]; then
    printf '%s\n' "$TRUSTED_COMMENT"
    return
  fi

  basename="$(basename "$file")"
  hash="$(sha256_hex "$file")"
  printf 'AX Code Desktop release artifact: %s; sha256=%s; signed=%s\n' "$basename" "$hash" "$SIGNED_AT"
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
    --public-key-string)
      shift
      [[ -n "${1:-}" ]] || { echo "error: --public-key-string requires an argument" >&2; exit 1; }
      PUBLIC_KEY_STRING="$1"
      ;;
    --pinned-public-key)
      shift
      [[ -n "${1:-}" ]] || { echo "error: --pinned-public-key requires an argument" >&2; exit 1; }
      PINNED_PUBLIC_KEY="$1"
      ;;
    --signature-dir)
      shift
      [[ -n "${1:-}" ]] || { echo "error: --signature-dir requires an argument" >&2; exit 1; }
      SIGNATURE_DIR="$1"
      ;;
    --trusted-comment)
      shift
      [[ -n "${1:-}" ]] || { echo "error: --trusted-comment requires an argument" >&2; exit 1; }
      TRUSTED_COMMENT="$1"
      ;;
    --untrusted-comment)
      shift
      [[ -n "${1:-}" ]] || { echo "error: --untrusted-comment requires an argument" >&2; exit 1; }
      UNTRUSTED_COMMENT="$1"
      ;;
    --keychain-service)
      shift
      [[ -n "${1:-}" ]] || { echo "error: --keychain-service requires an argument" >&2; exit 1; }
      KEYCHAIN_SERVICE="$1"
      ;;
    --keychain-account)
      shift
      [[ -n "${1:-}" ]] || { echo "error: --keychain-account requires an argument" >&2; exit 1; }
      KEYCHAIN_ACCOUNT="$1"
      ;;
    --force)
      FORCE=true
      ;;
    --no-verify)
      VERIFY=false
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      FILES+=("$1")
      ;;
  esac
  shift
done

SECRET_KEY="${SECRET_KEY:-$KEY_DIR/ax.minisign.key}"
PUBLIC_KEY="${PUBLIC_KEY:-$KEY_DIR/ax.pub}"
SIGNED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ "$DRY_RUN" != true ]]; then
  check_cmd minisign
fi
# shasum/sha256sum builds the default trusted comment; require it unconditionally
# so the contract does not silently change under dry-run.
if command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1; then
  :
else
  echo "error: neither sha256sum nor shasum is available" >&2
  exit 1
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  FILES=(
    desktop/packages/electron/dist/*.dmg
    desktop/packages/electron/dist/*.zip
    desktop/packages/electron/dist/*.exe
    desktop/packages/electron/dist/*.blockmap
    desktop/packages/electron/dist/latest*.yml
    desktop/packages/electron/dist/*.tar.gz
    desktop/packages/web/*.tgz
  )
fi

SIGN_FILES=()
for file in "${FILES[@]}"; do
  if [[ "$file" == *.minisig ]]; then
    continue
  fi
  if [[ -f "$file" ]]; then
    SIGN_FILES+=("$file")
  else
    echo "Not a regular file: $file" >&2
    exit 1
  fi
done

if [[ ${#SIGN_FILES[@]} -eq 0 ]]; then
  echo "No release artifacts found to sign." >&2
  echo "Pass explicit files or build/package the release artifacts first." >&2
  exit 1
fi

if [[ "$DRY_RUN" != true ]]; then
  if [[ ! -f "$SECRET_KEY" ]]; then
    echo "Secret key not found: $SECRET_KEY" >&2
    echo "Generate it with: pnpm run sign:keygen" >&2
    exit 1
  fi
  if [[ ! -r "$SECRET_KEY" ]]; then
    echo "error: secret key is not readable: $SECRET_KEY" >&2
    exit 1
  fi
  require_private_path "$SECRET_KEY" "secret key"
  require_private_path "$(dirname "$SECRET_KEY")" "secret key directory"

  if [[ "$VERIFY" == true && -z "$PUBLIC_KEY_STRING" && ! -f "$PUBLIC_KEY" ]]; then
    echo "Public key not found: $PUBLIC_KEY" >&2
    echo "Pass --public-key-string <key> or --no-verify." >&2
    exit 1
  fi

  # Fail closed if the local public key (or explicit string) diverges from the pin.
  if [[ -n "$PUBLIC_KEY_STRING" || -f "$PUBLIC_KEY" ]]; then
    require_pinned_public_key
  fi
fi

# Retrieve the passphrase: env var > macOS Keychain > "" (let minisign prompt).
_minisign_password_from_keychain() {
  [[ "$(uname -s)" == "Darwin" ]] || return 1
  command -v security >/dev/null 2>&1 || return 1
  security find-generic-password -w \
    -s "$KEYCHAIN_SERVICE" \
    -a "$KEYCHAIN_ACCOUNT" 2>/dev/null || return 1
}

_minisign_resolve_password() {
  if [[ -n "$MINISIGN_KEY_PASSWORD" ]]; then
    printf '%s' "$MINISIGN_KEY_PASSWORD"
    return 0
  fi
  _minisign_password_from_keychain || true
}

# Run minisign, piping the passphrase if one was resolved.
_run_minisign() {
  local pw
  pw="$(_minisign_resolve_password || true)"
  if [[ -n "$pw" ]]; then
    printf '%s\n' "$pw" | minisign "$@"
  else
    minisign "$@"
  fi
}

if [[ -n "$SIGNATURE_DIR" ]]; then
  mkdir -p "$SIGNATURE_DIR"
fi

echo "Secret key: $SECRET_KEY"
if [[ "$VERIFY" == true && "$DRY_RUN" != true ]]; then
  if [[ -n "$PUBLIC_KEY_STRING" ]]; then
    echo "Public key (string): $PUBLIC_KEY_STRING"
  elif [[ -f "$PUBLIC_KEY" ]]; then
    echo "Public key: $PUBLIC_KEY"
    local_key_id="$(public_key_id)"
    [[ -n "$local_key_id" ]] && echo "Public key id: $local_key_id"
  fi
  if [[ -n "$PINNED_PUBLIC_KEY" ]]; then
    echo "Pinned public key: $PINNED_PUBLIC_KEY (enforced)"
  fi
fi
if [[ "$UNTRUSTED_COMMENT" != "signature from ax-code-desktop local signing key" ]]; then
  echo "Untrusted comment: $UNTRUSTED_COMMENT"
fi

# Resolve output paths and validate existence up front so dry-run is accurate.
declare -a SIG_PATHS=()
for file in "${SIGN_FILES[@]}"; do
  if [[ -n "$SIGNATURE_DIR" ]]; then
    sig="${SIGNATURE_DIR}/$(basename "$file").minisig"
  else
    sig="${file}.minisig"
  fi
  if [[ -e "$sig" && "$FORCE" != true ]]; then
    echo "Signature already exists: $sig" >&2
    echo "Use --force only when you intentionally want to replace it." >&2
    exit 1
  fi
  SIG_PATHS+=("$sig")
  echo "  $file -> $sig"
done

if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run only; no signatures were created."
  exit 0
fi

for i in "${!SIGN_FILES[@]}"; do
  file="${SIGN_FILES[$i]}"
  sig="${SIG_PATHS[$i]}"
  trusted_comment="$(trusted_comment_for_file "$file")"

  minisign_args=(
    -S
    -s "$SECRET_KEY"
    -x "$sig"
    -c "$UNTRUSTED_COMMENT"
    -t "$trusted_comment"
    -m "$file"
  )
  if [[ "$FORCE" == true ]]; then
    rm -f "$sig"
  fi

  _run_minisign "${minisign_args[@]}"
  echo "signed: $sig"

  if [[ "$VERIFY" == true ]]; then
    verify_args=(-V -q -m "$file" -x "$sig")
    if [[ -n "$PUBLIC_KEY_STRING" ]]; then
      verify_args+=(-P "$PUBLIC_KEY_STRING")
    else
      verify_args+=(-p "$PUBLIC_KEY")
    fi
    minisign "${verify_args[@]}"
    echo "verified: $sig"
  fi
done

echo "Created signatures:"
for sig in "${SIG_PATHS[@]}"; do
  echo "  $sig"
done
