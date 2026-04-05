# R39: Release Channel Formalization

**Date:** 2026-04-04
**Status:** Documented — ready for CI implementation
**References:** PRD-ax-code-v2.md (R39)

---

## Release Channels

| Channel | npm Tag | Purpose | Example Version |
|---------|---------|---------|-----------------|
| `latest` | `latest` | Stable production release | `2.0.0` |
| `beta` | `beta` | Pre-release, 48hr minimum soak | `0.0.0-beta-202604041200` |
| `dev` | `dev` | Development builds, no soak | `0.0.0-dev-202604041200` |

## Existing Infrastructure

Already built:
- Channel-aware builds via `AX_CODE_CHANNEL` env var (`packages/script/src/index.ts`)
- npm publish with channel tags (`packages/ax-code/script/publish.ts`)
- Docker multi-platform builds with channel tags
- Homebrew/AUR/Scoop distribution
- GitHub Release artifacts (12 platform variants)
- Changelog generation via Claude (`script/changelog.ts`)
- Runtime channel detection (`src/installation/index.ts`: `VERSION`, `CHANNEL`, `isPreview()`)

## Release Process

### 1. Create Beta Release

```bash
# Trigger from main or release branch
AX_CODE_CHANNEL=beta AX_CODE_BUMP=minor ./script/publish.ts
```

This:
- Bumps version (e.g., `2.0.0-beta-202604041200`)
- Builds all platform binaries
- Publishes to npm with `beta` tag
- Pushes Docker image with `beta` tag
- Creates draft GitHub Release

### 2. 48-Hour Soak Period

Minimum 48 hours between beta publish and stable promotion. During soak:
- Monitor crash-free rate (target >= 99.5%)
- Check CI status on release branch
- Verify no critical issues reported
- Run live test suite if available

### 3. Promote to Stable

```bash
# After >= 48hr soak, promote beta to stable
AX_CODE_CHANNEL=latest AX_CODE_VERSION=2.0.0 ./script/publish.ts
```

This:
- Re-tags npm packages as `latest`
- Updates Docker `latest` tag
- Updates Homebrew formula
- Finalizes GitHub Release (removes draft status)
- Generates changelog

### 4. Emergency Rollback

If critical issues found after stable promotion:
```bash
# Unpublish the bad version and re-promote the previous stable
npm dist-tag add ax-code-ai@<previous-version> latest
```

## GitHub Actions Workflow (To Implement)

### `publish.yml` — Create Beta

```yaml
name: Publish Beta
on:
  workflow_dispatch:
    inputs:
      bump:
        description: 'Version bump type'
        required: true
        type: choice
        options: [patch, minor, major]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: AX_CODE_CHANNEL=beta AX_CODE_BUMP=${{ inputs.bump }} ./script/publish.ts
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### `promote.yml` — Promote to Stable

```yaml
name: Promote to Stable
on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Beta version to promote'
        required: true

jobs:
  promote:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check soak period
        run: |
          CREATED=$(gh release view v${{ inputs.version }} --json createdAt -q .createdAt)
          AGE_HOURS=$(( ($(date +%s) - $(date -d "$CREATED" +%s)) / 3600 ))
          if [ "$AGE_HOURS" -lt 48 ]; then
            echo "Release is only ${AGE_HOURS}h old. Minimum 48h soak required."
            exit 1
          fi
      - name: Promote
        run: AX_CODE_CHANNEL=latest AX_CODE_VERSION=${{ inputs.version }} ./script/publish.ts
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Promotion Checklist

Before promoting beta to stable:
- [ ] Beta soak >= 48 hours
- [ ] All CI tests passing on release branch
- [ ] No critical issues reported during soak
- [ ] Changelog reviewed and finalized
- [ ] Crash-free session rate >= 99.5% (if telemetry available)

## Success Criteria (from PRD)

- v2.0 beta soak >= 48hr before stable release
- Formal process documented
- CI workflows automate promotion gate
