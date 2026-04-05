#!/usr/bin/env bun

import { Script } from "@ax-code/script"
import { $ } from "bun"
import { fileURLToPath } from "url"

console.log("=== publishing ===\n")

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
    await $`git fetch origin`
    await $`git cherry-pick HEAD..origin/dev`.nothrow()
    await $`git push origin HEAD --tags --no-verify --force-with-lease`
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }

  await $`gh release edit v${Script.version} --draft=false --repo ${process.env.GH_REPO}`
}

console.log("\n=== cli ===\n")
await import(`../packages/ax-code/script/publish.ts`)

console.log("\n=== sdk ===\n")
await import(`../packages/sdk/js/script/publish.ts`)

console.log("\n=== plugin ===\n")
await import(`../packages/plugin/script/publish.ts`)

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)
