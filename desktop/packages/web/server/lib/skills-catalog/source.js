const GITHUB_HOST = "github.com"

function trimString(value) {
  return typeof value === "string" ? value.trim() : String(value || "").trim()
}

function normalizeOptionalSubpath(value) {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = trimString(value)
  return trimmed ? trimmed : null
}

function normalizeGitOwnerRepo(owner, repo) {
  const normalizedOwner = trimString(owner)
  const normalizedRepo = trimString(repo).replace(/\.git$/i, "")
  if (!normalizedOwner || !normalizedRepo) {
    return null
  }
  return { owner: normalizedOwner, repo: normalizedRepo }
}

function splitNonEmptyPath(value) {
  return String(value || "")
    .split("/")
    .filter(Boolean)
}

function parseSshScpSource(raw) {
  const atIndex = raw.indexOf("@")
  if (atIndex === -1) {
    return { host: "", pathSegments: [] }
  }

  const afterUser = raw.slice(atIndex + 1)
  if (afterUser.startsWith("[")) {
    const closingBracketIndex = afterUser.indexOf("]")
    if (closingBracketIndex === -1 || afterUser[closingBracketIndex + 1] !== ":") {
      return { host: afterUser, pathSegments: [] }
    }
    const host = afterUser.slice(0, closingBracketIndex + 1)
    const pathValue = afterUser.slice(closingBracketIndex + 2)
    return { host, pathSegments: splitNonEmptyPath(pathValue) }
  }

  const colonIndex = afterUser.indexOf(":")
  if (colonIndex === -1) {
    return { host: afterUser, pathSegments: [] }
  }

  const host = afterUser.slice(0, colonIndex)
  const pathValue = afterUser.slice(colonIndex + 1)
  return { host, pathSegments: splitNonEmptyPath(pathValue) }
}

function parseRemoteSource(raw, urlFormat) {
  if (urlFormat === "https") {
    const url = new URL(raw)
    const pathSegments = splitNonEmptyPath(url.pathname)
    return { host: url.host, pathSegments }
  }

  if (urlFormat === "ssh") {
    return parseSshScpSource(raw)
  }

  return null
}

function repoPartsFromSegments(pathSegments) {
  if (!Array.isArray(pathSegments) || pathSegments.length < 2) {
    return null
  }

  const repoName = pathSegments[pathSegments.length - 1]
  const gitOwner = pathSegments.slice(0, -1).join("/")
  return normalizeGitOwnerRepo(gitOwner, repoName)
}

function buildParsedRepoSource({ host, owner, repo, effectiveSubpath }) {
  return {
    ok: true,
    host,
    owner,
    repo,
    cloneUrlSsh: `git@${host}:${owner}/${repo}.git`,
    cloneUrlHttps: `https://${host}/${owner}/${repo}.git`,
    effectiveSubpath,
    normalizedRepo: `${owner}/${repo}`,
  }
}

export function parseSkillRepoSource(input, options = {}) {
  const raw = typeof input === "string" ? trimString(input) : ""
  if (!raw) {
    return { ok: false, error: { kind: "invalidSource", message: "Repository source is required" } }
  }
  const explicitSubpath = normalizeOptionalSubpath(options.subpath)

  const urlFormat = raw.startsWith("https://") ? "https" : raw.startsWith("git@") ? "ssh" : "shorthand"
  const remote = parseRemoteSource(raw, urlFormat)
  const gitHost = remote?.host ?? null

  if (gitHost === null && urlFormat !== "shorthand") {
    return { ok: false, error: { kind: "invalidSource", message: "Invalid repository URL format" } }
  }

  // SSH git@host:owner/repo(.git) or HTTPS https://host/owner/repo(.git)
  if (urlFormat === "ssh" || urlFormat === "https") {
    const parsed = repoPartsFromSegments(remote?.pathSegments)
    if (!parsed) {
      return { ok: false, error: { kind: "invalidSource", message: `Invalid ${urlFormat} repository URL` } }
    }

    return buildParsedRepoSource({
      host: gitHost,
      owner: parsed.owner,
      repo: parsed.repo,
      // For SSH URLs, subpath is only accepted via options.subpath
      effectiveSubpath: explicitSubpath,
    })
  }

  // Shorthand: owner/repo[/subpath...]
  const shorthandMatch = raw.match(/^([^/\s]+)\/([^/\s]+)(?:\/(.+))?$/)
  if (shorthandMatch) {
    const parsed = normalizeGitOwnerRepo(shorthandMatch[1], shorthandMatch[2])
    if (!parsed) {
      return { ok: false, error: { kind: "invalidSource", message: "Invalid repository source" } }
    }

    const shorthandSubpath = normalizeOptionalSubpath(shorthandMatch[3])
    const effectiveSubpath = explicitSubpath || shorthandSubpath

    return buildParsedRepoSource({
      host: GITHUB_HOST,
      owner: parsed.owner,
      repo: parsed.repo,
      effectiveSubpath,
    })
  }

  return { ok: false, error: { kind: "invalidSource", message: "Unsupported repository source format" } }
}
