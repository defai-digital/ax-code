import { execFileSync } from "child_process"
import { readFileSync } from "fs"
import path from "path"

// (The former bun-version guard is gone: these scripts run under Node now.)

const env = {
  AX_CODE_CHANNEL: process.env["AX_CODE_CHANNEL"],
  AX_CODE_BUMP: process.env["AX_CODE_BUMP"],
  AX_CODE_VERSION: process.env["AX_CODE_VERSION"],
  AX_CODE_RELEASE: process.env["AX_CODE_RELEASE"],
}
const CHANNEL = (() => {
  if (env.AX_CODE_CHANNEL) return env.AX_CODE_CHANNEL
  if (env.AX_CODE_BUMP) return "latest"
  if (env.AX_CODE_VERSION && !env.AX_CODE_VERSION.startsWith("0.0.0-")) return "latest"
  return execFileSync("git", ["branch", "--show-current"]).toString().trim()
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.AX_CODE_VERSION) return env.AX_CODE_VERSION.replace(/^v/, "")
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  const version = await fetch("https://api.github.com/repos/defai-digital/ax-code/releases/latest")
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => String(data.tag_name ?? "").replace(/^v/, ""))
  if (!version) throw new Error("Could not resolve latest ax-code GitHub release version")
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.AX_CODE_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

const bot = ["actions-user", "opencode", "opencode-agent[bot]"]
const teamPath = path.resolve(import.meta.dirname, "../../../.github/TEAM_MEMBERS")
const team = [
  ...readFileSync(teamPath, "utf8")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x && !x.startsWith("#")),
  ...bot,
]

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
  get release(): boolean {
    return !!env.AX_CODE_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`ax-code script`, JSON.stringify(Script, null, 2))
