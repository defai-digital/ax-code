#!/usr/bin/env bun

import { Script } from "@ax-code/script"
import { $ } from "bun"
import { fileURLToPath } from "url"
import { runChecks, type CheckResult } from "../packages/ax-code/src/cli/cmd/release/check"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

function releaseFailures(results: CheckResult[]) {
  return results.filter((result) => result.status === "fail")
}

function formatReleaseFailures(results: CheckResult[]) {
  return results.map((result) => `- ${result.name}: ${result.detail}`).join("\n")
}

async function ensureStableReleaseBranch() {
  const branch = await $`git branch --show-current`
    .cwd(repoRoot)
    .text()
    .then((text) => text.trim())
  if (branch !== "main") {
    throw new Error(`Stable releases must run from main; current branch is ${branch || "(detached HEAD)"}.`)
  }
}

async function runStableReleasePreflight() {
  const results = await runChecks({
    repoRoot,
    version: Script.version,
    withTests: true,
    fetch: true,
    skip: new Set(),
  })
  const failures = releaseFailures(results)
  if (failures.length === 0) return
  throw new Error(`Release preflight failed for v${Script.version}:\n${formatReleaseFailures(failures)}`)
}

console.log("=== publishing ===\n")

if (Script.release && !Script.preview) {
  console.log("=== release preflight ===\n")
  await ensureStableReleaseBranch()
  await runStableReleasePreflight()
  console.log(`release preflight passed for v${Script.version}\n`)
}

// Only packages/ax-code is versioned off the release tag. Other workspace
// packages (sdk, plugin, ui, util, integration-*) carry independent
// versions and are bumped in their own release cadences.
const axCodePkg = fileURLToPath(new URL("../packages/ax-code/package.json", import.meta.url))
const pkgText = await Bun.file(axCodePkg).text()
await Bun.file(axCodePkg).write(pkgText.replace(/"version": "[^"]+"/, `"version": "${Script.version}"`))
console.log("updated:", axCodePkg)

await $`pnpm install`
await import(`../packages/sdk/js/script/build.ts`)

if (Script.release) {
  if (!Script.preview) {
    await $`git commit -am "release: v${Script.version}"`
    await $`git tag v${Script.version}`
    await $`git push origin HEAD:main --no-verify`
    await $`git push origin v${Script.version}`
  }

  await $`gh release edit v${Script.version} --draft=false --repo ${process.env.GH_REPO}`
}

console.log("\n=== cli ===\n")
await import(`../packages/ax-code/script/publish.ts`)

console.log("\n=== sdk ===\n")
await import(`../packages/sdk/js/script/publish.ts`)

console.log("\n=== plugin ===\n")
await import(`../packages/plugin/script/publish.ts`)

process.chdir(repoRoot)
