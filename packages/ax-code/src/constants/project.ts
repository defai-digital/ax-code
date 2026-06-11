// Canonical project identity. The GitHub org/repo slug is referenced in
// ~20 places — repo links, raw schema URLs, the releases API, the
// Homebrew tap, the install script, and GitHub Action refs. Centralizing
// it here means an org move or repository rename touches one file instead
// of every call site. See issue #17 (the config schema URL was the first
// of these to bite us when it was copy-pasted into four locations).

export const GITHUB_ORG = "defai-digital"
export const PACKAGE_NAME = "ax-code"

/** `defai-digital/ax-code` — the canonical owner/repo slug. */
export const GITHUB_REPO_SLUG = `${GITHUB_ORG}/${PACKAGE_NAME}`

/** Public repository home: docs links, OAuth client metadata, referer headers. */
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO_SLUG}`

/** New-issue page; callers append a `?template=` query as needed. */
export const GITHUB_NEW_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new`

/** GitHub REST endpoint for the latest published release. */
export const GITHUB_LATEST_RELEASE_API_URL = `https://api.github.com/repos/${GITHUB_REPO_SLUG}/releases/latest`

/** GitHub Action reference (`owner/repo/path`) used in generated workflow YAML. */
export const GITHUB_ACTION_REF = `${GITHUB_REPO_SLUG}/github`

// Raw content served from the default branch.
const RAW_MAIN_BASE = `https://raw.githubusercontent.com/${GITHUB_REPO_SLUG}/main`

/** JSON Schema for `ax-code.json`, written into user configs that omit `$schema`. */
export const CONFIG_SCHEMA_URL = `${RAW_MAIN_BASE}/packages/${PACKAGE_NAME}/config.schema.json`

/** JSON Schema for the TUI config, used by the legacy-config migrator. */
export const TUI_SCHEMA_URL = `${RAW_MAIN_BASE}/packages/${PACKAGE_NAME}/tui.schema.json`

/** Shell installer fetched by the curl-based self-upgrade path. */
export const INSTALL_SCRIPT_URL = `${RAW_MAIN_BASE}/install`

// Homebrew distribution. The tap shares the repo slug; formulae are
// published as `ax-code` (with a legacy `ax` alias on older taps).
export const HOMEBREW_TAP = GITHUB_REPO_SLUG
export const HOMEBREW_FORMULA_API_URL = `https://formulae.brew.sh/api/formula/${PACKAGE_NAME}.json`
