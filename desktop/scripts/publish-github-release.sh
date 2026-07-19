#!/usr/bin/env bash
#
# Publish an AX Code Desktop GitHub release without skipping the release gates.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(git -C "$DESKTOP_ROOT" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

VERSION=""
REMOTE="origin"
BRANCH=""
REPO=""
KEY_DIR="${SIGNKEY_DIR:-$HOME/signkey}"
CANONICAL_MINISIGN_PUBLIC_KEY="$REPO_ROOT/docs/ax-minisign.pub"
PUBLISH=false
ALLOW_DIRTY=false
ALLOW_BRANCH=false
ALLOW_UNPUSHED=false
SKIP_LOCAL_VALIDATION=false
SKIP_SIGNING=false
SKIP_SIGNING_KEY_PROBE=false
WATCH=true
SIGNATURES_ONLY=false

usage() {
  cat <<'EOF'
Usage: ./scripts/publish-github-release.sh [options]

Runs the local release gates, creates/pushes the release tag, watches the
GitHub release workflow, and verifies that the workflow published detached
minisign signatures for every release asset.

Options:
  --version <x.y.z>        Release version (default: desktop web package version)
  --publish                Actually push the tag and upload signatures
  --signatures-only        Only download/sign/upload assets for an existing release
  --repo <owner/name>      GitHub repository (default: inferred from gh)
  --remote <name>          Git remote for tag push (default: origin)
  --branch <name>          Required release branch (default: origin HEAD or main)
  --key-dir <path>         Minisign key directory (default: ~/signkey)
  --allow-dirty            Allow a dirty working tree
  --allow-branch           Allow publishing from a non-release branch
  --allow-unpushed         Allow dry-run preflight when HEAD differs from remote branch
  --skip-local-validation  Skip docs/test/type-check/lint/build
  --skip-signing           Do not require .minisig release assets
  --skip-signing-key-probe Deprecated; accepted for older command history
  --no-watch               Push the tag but do not wait for the GitHub run
  --help                   Show this help

Without --publish this is a preflight dry run. No tag, GitHub release, or
signature asset is created.
EOF
}

log() {
  echo "==> $1"
}

fail() {
  echo "Error: $1" >&2
  exit 1
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "$1 is required"
  fi
}

json_field() {
  local file="$1"
  local field="$2"
  node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); console.log(data[process.argv[2]] ?? '');" "$file" "$field"
}

default_branch() {
  local remote_head

  remote_head="$(git symbolic-ref --quiet --short "refs/remotes/$REMOTE/HEAD" 2>/dev/null || true)"
  if [[ -n "$remote_head" ]]; then
    echo "${remote_head#"$REMOTE/"}"
    return
  fi

  echo "main"
}

resolve_repo() {
  if [[ -n "$REPO" ]]; then
    echo "$REPO"
    return
  fi

  gh repo view --json nameWithOwner --jq '.nameWithOwner'
}

validate_version() {
  if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$ ]]; then
    fail "version must look like 0.8.0 or 0.8.0-rc.1, got: $VERSION"
  fi
}

validate_package_versions() {
  VERSION="$VERSION" node <<'NODE'
  const fs = require('fs');
  const version = process.env.VERSION;
  const packagePaths = [
    'desktop/packages/web/package.json',
    'desktop/packages/ui/package.json',
    'desktop/packages/electron/package.json',
  ];

  const mismatches = [];
  for (const path of packagePaths) {
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    if (pkg.version !== version) {
      mismatches.push(`${path}: ${pkg.version}`);
    }
  }

  if (mismatches.length > 0) {
    console.error(`Package versions must all equal ${version}:`);
    for (const mismatch of mismatches) {
      console.error(`  ${mismatch}`);
    }
    process.exit(1);
  }
NODE
}

validate_changelog() {
  VERSION="$VERSION" node <<'NODE'
  const fs = require('fs');
  const version = process.env.VERSION;
  const changelog = fs.readFileSync('desktop/CHANGELOG.md', 'utf8');
  const sections = changelog.split(/^## /m);
  const section = sections.find((part) => part.startsWith(`[${version}]`));

  if (!section) {
    console.error(`CHANGELOG.md is missing a section for [${version}].`);
    console.error(`Add a section like: ## [${version}] - YYYY-MM-DD`);
    process.exit(1);
  }

  const body = section
    .split('\n')
    .slice(1)
    .join('\n')
    .replace(/^## .*/ms, '')
    .trim();

  if (!body) {
    console.error(`CHANGELOG.md section [${version}] is empty.`);
    process.exit(1);
  }
NODE
}

validate_minisign_key() {
  local secret_key="${MINISIGN_SECRET_KEY:-$KEY_DIR/ax.minisign.key}"
  local public_key="${MINISIGN_PUBLIC_KEY:-$KEY_DIR/ax.pub}"

  [[ -f "$secret_key" ]] || fail "minisign secret key not found: $secret_key. Run: desktop/scripts/minisign-keygen.sh"
  [[ -f "$public_key" ]] || fail "minisign public key not found: $public_key. Run: desktop/scripts/minisign-keygen.sh"

  log "Using minisign public key:"
  awk '/^untrusted comment: minisign public key / { print "    key id: " $NF; found = 1 } END { if (!found) exit 1 }' "$public_key" \
    || fail "could not read minisign public key id from $public_key"
}

probe_minisign_key() {
  local probe_dir
  probe_dir="$(mktemp -d "${TMPDIR:-/tmp}/ax-code-desktop-signing-probe.XXXXXX")"
  trap 'rm -rf "$probe_dir"' RETURN

  printf 'AX Code Desktop signing key probe for %s\n' "$VERSION" > "$probe_dir/probe.txt"
  ./desktop/scripts/minisign-artifacts.sh --key-dir "$KEY_DIR" --force "$probe_dir/probe.txt" >/dev/null
  log "Minisign key probe succeeded"
}

validate_git_state() {
  local current_branch
  local head_sha
  local remote_head_sha
  local tag="$1"

  current_branch="$(git branch --show-current)"
  if [[ -z "$current_branch" ]]; then
    fail "HEAD is detached; publish from the release branch"
  fi

  if [[ "$ALLOW_BRANCH" != true && "$current_branch" != "$BRANCH" ]]; then
    fail "current branch is $current_branch, expected $BRANCH. Use --allow-branch to override."
  fi

  if [[ "$ALLOW_DIRTY" != true && -n "$(git status --porcelain)" ]]; then
    fail "working tree is dirty. Commit or stash changes before publishing."
  fi

  git fetch "$REMOTE" "+refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH"

  head_sha="$(git rev-parse HEAD)"
  remote_head_sha="$(git rev-parse "$REMOTE/$BRANCH")"
  if [[ "$head_sha" != "$remote_head_sha" ]]; then
    if [[ "$ALLOW_UNPUSHED" == true && "$PUBLISH" != true ]]; then
      log "Dry run allowed with unpushed HEAD ($head_sha differs from $REMOTE/$BRANCH $remote_head_sha)"
    else
      fail "HEAD ($head_sha) is not the same as $REMOTE/$BRANCH ($remote_head_sha). Push or pull the release branch first."
    fi
  fi

  if git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null; then
    fail "local tag already exists: $tag"
  fi

  if git ls-remote --exit-code --tags "$REMOTE" "refs/tags/$tag" >/dev/null 2>&1; then
    fail "remote tag already exists: $tag"
  fi
}

validate_release_absent() {
  local tag="$1"
  local repo="$2"

  if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
    fail "GitHub release already exists: $tag"
  fi
}

run_local_validation() {
  log "Running docs validation"
  node desktop/scripts/docs/validate-docs.mjs

  log "Running tests"
  pnpm run desktop:test

  log "Running type-check"
  pnpm run desktop:typecheck

  log "Running lint"
  pnpm run desktop:lint

  log "Running build"
  pnpm run desktop:build
}

create_and_push_tag() {
  local tag="$1"

  log "Creating annotated tag $tag"
  git tag -a "$tag" -m "AX Code Desktop $tag"

  log "Pushing tag $tag to $REMOTE"
  git push "$REMOTE" "$tag"
}

find_release_run() {
  local tag="$1"
  local head_sha="$2"
  local run_id
  local runs_json

  for _ in {1..60}; do
    runs_json="$(gh run list --workflow desktop-release.yml --limit 30 --json databaseId,headBranch,headSha,event,status,conclusion,createdAt)"
    run_id="$(
      RUNS_JSON="$runs_json" TAG="$tag" HEAD_SHA="$head_sha" node <<'NODE'
      const runs = JSON.parse(process.env.RUNS_JSON);
      const tag = process.env.TAG;
      const headSha = process.env.HEAD_SHA;
      const run = runs.find((candidate) =>
        candidate.headBranch === tag || candidate.headSha === headSha
      );
      if (run) {
        console.log(run.databaseId);
      }
NODE
    )"

    if [[ -n "$run_id" ]]; then
      echo "$run_id"
      return
    fi

    sleep 10
  done

  fail "could not find a release workflow run for $tag"
}

download_sign_and_upload_assets() {
  local tag="$1"
  local repo="$2"
  local download_dir
  local files=()
  local sig_files=()
  local file

  download_dir="$(mktemp -d "${TMPDIR:-/tmp}/ax-code-desktop-release-assets.XXXXXX")"
  log "Downloading release assets into $download_dir"
  gh release download "$tag" --repo "$repo" --dir "$download_dir" --clobber

  while IFS= read -r -d '' file; do
    case "$file" in
      *.minisig|*.sig|*/ax-minisign.pub)
        ;;
      *)
        files+=("$file")
        ;;
    esac
  done < <(find "$download_dir" -type f -print0)

  if [[ ${#files[@]} -eq 0 ]]; then
    fail "no release assets found to sign for $tag"
  fi

  log "Signing ${#files[@]} release asset(s)"
  ./desktop/scripts/minisign-artifacts.sh --key-dir "$KEY_DIR" --force "${files[@]}"

  while IFS= read -r -d '' file; do
    sig_files+=("$file")
  done < <(find "$download_dir" -type f -name '*.minisig' -print0)

  if [[ ${#sig_files[@]} -eq 0 ]]; then
    fail "no .minisig files were produced"
  fi

  [[ -f "$CANONICAL_MINISIGN_PUBLIC_KEY" ]] || {
    fail "canonical minisign public key not found: $CANONICAL_MINISIGN_PUBLIC_KEY"
  }
  log "Uploading ${#sig_files[@]} minisign signature asset(s) and canonical public key"
  gh release upload "$tag" --repo "$repo" --clobber \
    "${sig_files[@]}" \
    "$CANONICAL_MINISIGN_PUBLIC_KEY"
}

verify_release_assets() {
  local tag="$1"
  local repo="$2"
  local release_json

  release_json="$(gh release view "$tag" --repo "$repo" --json assets,isDraft,url)"
  RELEASE_JSON="$release_json" SKIP_SIGNING="$SKIP_SIGNING" node <<'NODE'
  const release = JSON.parse(process.env.RELEASE_JSON);
  const names = new Set(release.assets.map((asset) => asset.name));
  const unsignedAssets = release.assets
    .map((asset) => asset.name)
    .filter((name) => !name.endsWith('.minisig') && !name.endsWith('.sig') && name !== 'ax-minisign.pub');

  if (release.isDraft) {
    console.error('Release is still a draft.');
    process.exit(1);
  }

  if (unsignedAssets.length === 0) {
    console.error('Release has no downloadable assets.');
    process.exit(1);
  }

  if (process.env.SKIP_SIGNING !== 'true') {
    if (!names.has('ax-minisign.pub')) {
      console.error('Release is missing the canonical ax-minisign.pub key.');
      process.exit(1);
    }
    const missing = unsignedAssets.filter((name) => !names.has(`${name}.minisig`));
    if (missing.length > 0) {
      console.error('Release assets missing minisign signatures:');
      for (const name of missing) {
        console.error(`  ${name}`);
      }
      process.exit(1);
    }
  }

  console.log(release.url);
NODE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    --version)
      VERSION="${2:?Missing value for --version}"
      shift 2
      ;;
    --publish)
      PUBLISH=true
      shift
      ;;
    --signatures-only)
      SIGNATURES_ONLY=true
      shift
      ;;
    --repo)
      REPO="${2:?Missing value for --repo}"
      shift 2
      ;;
    --remote)
      REMOTE="${2:?Missing value for --remote}"
      shift 2
      ;;
    --branch)
      BRANCH="${2:?Missing value for --branch}"
      shift 2
      ;;
    --key-dir)
      KEY_DIR="${2:?Missing value for --key-dir}"
      shift 2
      ;;
    --allow-dirty)
      ALLOW_DIRTY=true
      shift
      ;;
    --allow-branch)
      ALLOW_BRANCH=true
      shift
      ;;
    --allow-unpushed)
      ALLOW_UNPUSHED=true
      shift
      ;;
    --skip-local-validation)
      SKIP_LOCAL_VALIDATION=true
      shift
      ;;
    --skip-signing)
      SKIP_SIGNING=true
      shift
      ;;
    --skip-signing-key-probe)
      SKIP_SIGNING_KEY_PROBE=true
      shift
      ;;
    --no-watch)
      WATCH=false
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_command node
require_command pnpm
require_command git
require_command gh

VERSION="${VERSION:-$(json_field desktop/packages/web/package.json version)}"
TAG="desktop-v$VERSION"
BRANCH="${BRANCH:-$(default_branch)}"

validate_version
validate_package_versions
validate_changelog

if [[ "$SKIP_SIGNING" != true ]]; then
  if [[ "$SIGNATURES_ONLY" == true ]]; then
    require_command minisign
    validate_minisign_key
  fi
fi

REPO="$(resolve_repo)"
log "Release: $TAG"
log "Repository: $REPO"
log "Release branch: $BRANCH"

gh auth status >/dev/null

if [[ "$SIGNATURES_ONLY" == true ]]; then
  if [[ "$PUBLISH" != true ]]; then
    log "Dry run: would download, sign, upload, and verify signatures for $TAG"
    exit 0
  fi

  if [[ "$SKIP_SIGNING" == true ]]; then
    fail "--signatures-only cannot be combined with --skip-signing"
  fi

  download_sign_and_upload_assets "$TAG" "$REPO"
  release_url="$(verify_release_assets "$TAG" "$REPO")"
  log "Release signatures verified: $release_url"
  exit 0
fi

validate_git_state "$TAG"
validate_release_absent "$TAG" "$REPO"

if [[ "$SKIP_LOCAL_VALIDATION" != true ]]; then
  run_local_validation
else
  log "Skipping local validation by request"
fi

if [[ "$PUBLISH" != true ]]; then
  log "Dry run complete. Re-run with --publish to create and push $TAG."
  exit 0
fi

HEAD_SHA="$(git rev-parse HEAD)"
create_and_push_tag "$TAG"

if [[ "$WATCH" != true ]]; then
  log "Tag pushed. Not watching workflow because --no-watch was used."
  exit 0
fi

RUN_ID="$(find_release_run "$TAG" "$HEAD_SHA")"
log "Watching release workflow run $RUN_ID"
gh run watch "$RUN_ID" --exit-status

release_url="$(verify_release_assets "$TAG" "$REPO")"
log "GitHub release published: $release_url"
