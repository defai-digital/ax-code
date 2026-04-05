import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
// The build script runs under Bun. Before v2.3.17 this parsed the
// root `packageManager` field (which holds the pnpm version) and
// compared it against `process.versions.bun`. Since pnpm is at 9.x
// and Bun is at 1.x, the check always failed:
//
//   error: This script requires bun@^9.15.9, but you are using bun@1.3.5
//
// breaking every local `bun run script/build.ts` invocation. CI
// bypassed the check because `oven-sh/setup-bun` ran Bun in a
// different harness. Fixed by reading from the root `engines.bun`
// field (npm/pnpm standard), which was added in the same commit.
// See issue #19.
const expectedBunVersionRange = rootPkg.engines?.bun

if (!expectedBunVersionRange) {
  throw new Error("engines.bun field not found in root package.json — expected a semver range like '^1.3.11'")
}

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  AX_CODE_CHANNEL: process.env["AX_CODE_CHANNEL"],
  AX_CODE_BUMP: process.env["AX_CODE_BUMP"],
  AX_CODE_VERSION: process.env["AX_CODE_VERSION"],
  AX_CODE_RELEASE: process.env["AX_CODE_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.AX_CODE_CHANNEL) return env.AX_CODE_CHANNEL
  if (env.AX_CODE_BUMP) return "latest"
  if (env.AX_CODE_VERSION && !env.AX_CODE_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.AX_CODE_VERSION) return env.AX_CODE_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  const version = await fetch("https://registry.npmjs.org/opencode-ai/latest")
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => data.version)
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.AX_CODE_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

const bot = ["actions-user", "opencode", "opencode-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const team = [
  ...(await Bun.file(teamPath)
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
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
console.log(`opencode script`, JSON.stringify(Script, null, 2))
