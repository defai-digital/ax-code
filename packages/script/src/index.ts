import { execFileSync } from "child_process"

// (The former bun-version guard is gone: these scripts run under Node now.)

const env = {
  AX_CODE_CHANNEL: process.env["AX_CODE_CHANNEL"],
  AX_CODE_BUMP: process.env["AX_CODE_BUMP"],
  AX_CODE_VERSION: process.env["AX_CODE_VERSION"],
}
const CHANNEL = (() => {
  if (env.AX_CODE_CHANNEL) return env.AX_CODE_CHANNEL
  if (env.AX_CODE_BUMP) return "latest"
  if (env.AX_CODE_VERSION && !env.AX_CODE_VERSION.startsWith("0.0.0-")) return "latest"
  const branch = execFileSync("git", ["branch", "--show-current"]).toString().trim()
  if (!branch) {
    // Detached HEAD exits 0 with empty output; an empty channel would produce
    // an invalid preview version ("0.0.0--...") and an unusable npm dist-tag.
    throw new Error("Could not resolve release channel: git HEAD is detached. Set AX_CODE_CHANNEL explicitly.")
  }
  return branch
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.AX_CODE_VERSION) return env.AX_CODE_VERSION.replace(/^v/, "")
  if (IS_PREVIEW) {
    // Channel names can contain characters that are invalid in semver prerelease
    // identifiers (e.g. "feature/release"); normalize so preview versions stay parseable.
    // Include seconds (14 digits): minute precision let two builds in the same
    // UTC minute collide on the same preview version.
    const channel = CHANNEL.replace(/[^a-zA-Z0-9-]/g, "-")
    return `0.0.0-${channel}-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}`
  }
  const version = await fetch("https://api.github.com/repos/defai-digital/ax-code/releases?per_page=50")
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: unknown) => {
      if (!Array.isArray(data)) throw new Error("GitHub releases response was not an array")
      for (const release of data) {
        const tag =
          release && typeof release === "object" && "tag_name" in release ? String(release.tag_name ?? "") : ""
        if (/^v\d+\.\d+\.\d+$/.test(tag)) return tag.slice(1)
      }
      return ""
    })
  if (!version) throw new Error("Could not resolve latest ax-code GitHub release version")
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.AX_CODE_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
}
console.log(`ax-code script`, JSON.stringify(Script, null, 2))
