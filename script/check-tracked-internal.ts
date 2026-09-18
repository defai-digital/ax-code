#!/usr/bin/env -S npx tsx
import { spawnSync } from "node:child_process"
import {
  INTERNAL_ONLY_ROOTS,
  LOCAL_DUMP_PATHSPECS,
  LOCAL_ONLY_PATHSPECS,
  LOCAL_ONLY_ROOT_FILES,
  unapprovedTrackedInternalPaths,
} from "./repository-policy"

// Local-only paths that must never be committed or pushed to GitHub. The
// pathspec list is shared with .husky/pre-commit so the two guards cannot
// drift apart.
const INTERNAL_ROOT = INTERNAL_ONLY_ROOTS[0]

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

let failed = false

const trackedInternal = trackedPaths([INTERNAL_ROOT])
const unapproved = unapprovedTrackedInternalPaths(trackedInternal)
if (unapproved.length > 0) {
  console.error("Internal-only files must not be tracked:")
  for (const file of unapproved) console.error(`- ${file}`)
  failed = true
}

const trackedRootFiles = trackedPaths(LOCAL_ONLY_ROOT_FILES)
if (trackedRootFiles.length > 0) {
  console.error("Local-only root files must not be tracked:")
  for (const file of trackedRootFiles) console.error(`- ${file}`)
  failed = true
}

const trackedDumps = trackedPaths(LOCAL_DUMP_PATHSPECS)
if (trackedDumps.length > 0) {
  console.error("Local dump/config files must not be tracked:")
  for (const file of trackedDumps) console.error(`- ${file}`)
  failed = true
}

if (failed) {
  console.error("These paths are gitignored; do not force-add them.")
  console.error("Untrack them with: git rm --cached -- <path>")
  process.exit(1)
}

console.log(`No local-only files (${LOCAL_ONLY_PATHSPECS} ${LOCAL_DUMP_PATHSPECS.join(" ")}) are tracked`)
