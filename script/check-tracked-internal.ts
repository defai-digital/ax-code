#!/usr/bin/env -S npx tsx
import { spawnSync } from "node:child_process"
import { unapprovedTrackedInternalPaths } from "./repository-policy"

// Local-only paths that must never be committed or pushed to GitHub.
const LOCAL_ONLY_PATTERNS = [".internal", "AGENTS.md"] as const

function trackedPaths(patterns: readonly string[]) {
  const result = spawnSync("git", ["ls-files", "--", ...patterns], { encoding: "utf8" })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`git ls-files exited with status ${result.status}: ${result.stderr.trim()}`)
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

const trackedInternal = trackedPaths([LOCAL_ONLY_PATTERNS[0]])
const unapproved = unapprovedTrackedInternalPaths(trackedInternal)
if (unapproved.length > 0 || trackedInternal.length > 0) {
  console.error("Internal-only files must not be tracked:")
  for (const file of unapproved.length > 0 ? unapproved : trackedInternal) console.error(`- ${file}`)
  process.exit(1)
}

const trackedAgents = trackedPaths([LOCAL_ONLY_PATTERNS[1]])
if (trackedAgents.length > 0) {
  console.error("AGENTS.md is local-only and must not be tracked:")
  for (const file of trackedAgents) console.error(`- ${file}`)
  process.exit(1)
}

console.log("No local-only files (.internal, AGENTS.md) are tracked")
