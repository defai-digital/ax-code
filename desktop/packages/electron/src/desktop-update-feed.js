// AX Code ships two release channels from one GitHub repository: CLI tags
// (v*) and Desktop tags (desktop-v*). electron-updater's GitHub provider
// always resolves the repo-wide "latest" release, which is usually a CLI
// release whose assets carry no desktop update manifests — every update
// check then fails with ERR_UPDATER_CHANNEL_FILE_NOT_FOUND and the app can
// never self-update. Resolve the newest published desktop-v* release
// ourselves and point electron-updater's generic provider at that release's
// asset downloads instead.
const GITHUB_OWNER = "defai-digital"
const GITHUB_REPO = "ax-code"
const DESKTOP_RELEASE_TAG_PREFIX = "desktop-v"
const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`
const RELEASE_DOWNLOAD_BASE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download`
const DESKTOP_TAG_VERSION_PATTERN =
  /^desktop-v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function parseDesktopTagVersion(tag) {
  const match = typeof tag === "string" ? DESKTOP_TAG_VERSION_PATTERN.exec(tag) : null
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  }
}

// Minimal semver precedence (https://semver.org/#spec-item-11) — enough to
// rank desktop-v* tags without pulling a semver dependency into the main
// process bundle.
function compareDesktopTagVersions(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  // A release outranks any of its prereleases.
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.min(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < length; i += 1) {
    const left = a.prerelease[i]
    const right = b.prerelease[i]
    if (left === right) continue
    const leftNumeric = /^\d+$/.test(left)
    const rightNumeric = /^\d+$/.test(right)
    if (leftNumeric && rightNumeric) return Number(left) < Number(right) ? -1 : 1
    // Numeric identifiers sort below alphanumeric ones.
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return left < right ? -1 : 1
  }
  return a.prerelease.length - b.prerelease.length
}

function desktopReleaseFor(release) {
  if (!release || typeof release !== "object") return null
  if (release.draft || release.prerelease) return null
  const version = parseDesktopTagVersion(release.tag_name)
  if (!version) return null
  return { tag: release.tag_name, version }
}

// The releases API does not guarantee newest-first ordering (CLI and
// desktop releases created minutes apart come back interleaved out of
// order), so rank candidates by their tag's semver instead of list
// position. Draft releases are not visible without a token; the draft check
// is defense in depth.
function latestDesktopReleaseTag(releases) {
  if (!Array.isArray(releases)) return null
  let best = null
  for (const release of releases) {
    const candidate = desktopReleaseFor(release)
    if (!candidate) continue
    if (!best || compareDesktopTagVersions(candidate.version, best.version) > 0) best = candidate
  }
  return best ? best.tag : null
}

function desktopUpdateFeedUrl(tag) {
  return `${RELEASE_DOWNLOAD_BASE_URL}/${tag}`
}

async function resolveDesktopUpdateFeed(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation available to resolve the desktop update feed")
  }
  // CLI and desktop releases interleave roughly 1:1, so one page covers many
  // desktop versions back — far more than the updater ever needs to span.
  const perPage = options.perPage ?? 30
  const response = await fetchImpl(`${RELEASES_API_URL}?per_page=${perPage}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "ax-code-desktop-updater",
    },
  })
  if (!response || !response.ok) {
    const status = response ? `HTTP ${response.status}` : "no response"
    throw new Error(`Failed to list GitHub releases while resolving the desktop update feed (${status})`)
  }
  const releases = await response.json()
  const tag = latestDesktopReleaseTag(releases)
  if (!tag) {
    throw new Error("No published AX Code Desktop release found while resolving the update feed")
  }
  return { tag, url: desktopUpdateFeedUrl(tag) }
}

module.exports = {
  DESKTOP_RELEASE_TAG_PREFIX,
  compareDesktopTagVersions,
  desktopUpdateFeedUrl,
  latestDesktopReleaseTag,
  resolveDesktopUpdateFeed,
}
