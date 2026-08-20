#!/usr/bin/env -S npx tsx
import { spawnSync } from "node:child_process"
import { unapprovedTrackedInternalPaths } from "./repository-policy"

const result = spawnSync("git", ["ls-files", ".internal"], { encoding: "utf8" })
if (result.error) throw result.error
if (result.status !== 0) {
  throw new Error(`git ls-files .internal exited with status ${result.status}: ${result.stderr.trim()}`)
}

const tracked = result.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
const unapproved = unapprovedTrackedInternalPaths(tracked)
if (unapproved.length > 0) {
  console.error("Unapproved internal-only files are tracked:")
  for (const file of unapproved) console.error(`- ${file}`)
  process.exit(1)
}

console.log(`Tracked internal architecture allowlist verified (${tracked.length} files)`)
