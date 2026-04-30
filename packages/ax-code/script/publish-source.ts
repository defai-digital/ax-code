#!/usr/bin/env bun
/**
 * Build and publish the source distribution npm package.
 *
 * The source distribution is the dual-publish counterpart to
 * `script/publish.ts` (compiled binaries). It produces a single npm
 * tarball that ships:
 *
 *   - `bundle/`        Bun.build output (no --compile), self-contained JS
 *   - `bin/ax-code`    sh shim that execs bun against bundle/index.js
 *   - `bin/ax-code.cmd` Windows variant
 *   - `bin/postinstall.mjs`  detects bun on PATH or in node_modules
 *   - `package.json`   declares `bun` as a regular dependency
 *
 * `@defai.digital/ax-code-source` is kept as a compatibility package for
 * users who intentionally need the source+bun launcher. The primary
 * `@defai.digital/ax-code` package is the compiled-binary distribution.
 *
 * See: automatosx/adr/ADR-002-distribution-source-plus-bun.md
 */
import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import pkg from "../package.json"
import { META_PACKAGE_NAME, SOURCE_PACKAGE_NAME } from "./package-names"
import {
  DEFAULT_BUN_DEPENDENCY_RANGE,
  buildChannelForVersion,
  sourceDistributionCmdShim,
  sourceDistributionPostinstall,
  sourceDistributionUnixShim,
  sourcePackageManifest,
} from "./source-package"

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
process.chdir(dir)

const BUN_DEPENDENCY_RANGE = process.env.AX_CODE_BUN_RANGE ?? DEFAULT_BUN_DEPENDENCY_RANGE
const OPENTUI_CORE_VERSION = pkg.dependencies["@opentui/core"]

const buildVersion = (process.env.AX_CODE_VERSION ?? pkg.version).replace(/^v/, "")
const SOURCE_DIST_TAG = process.env.AX_CODE_SOURCE_TAG ?? buildChannelForVersion(buildVersion)
const SOURCE_PACKAGE_NAMES = (process.env.AX_CODE_SOURCE_PACKAGE_NAMES ?? `${META_PACKAGE_NAME},${SOURCE_PACKAGE_NAME}`)
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean)
if (SOURCE_PACKAGE_NAMES.length === 0) {
  throw new Error("AX_CODE_SOURCE_PACKAGE_NAMES resolved to an empty package list")
}

console.log(`publish-source: version=${buildVersion} tag=${SOURCE_DIST_TAG} packages=${SOURCE_PACKAGE_NAMES.join(",")}`)

// Step 1: build the bundle. Reuse build-source.ts so anyone running
// publish-source.ts gets the same bundle layout the smoke tests assert.
{
  const result = await $`bun run script/build-source.ts`.nothrow()
  if (result.exitCode !== 0) {
    console.error("build-source.ts failed; aborting publish")
    process.exit(result.exitCode)
  }
}

const bundleDir = path.join(dir, "dist-source/bundle")
if (!fs.existsSync(path.join(bundleDir, "index.js"))) {
  console.error(`Expected bundle at ${bundleDir}/index.js after build-source.ts`)
  process.exit(1)
}

// Step 2: stage the npm tarball layout under dist-source/package/.
const stageDir = path.join(dir, "dist-source/package")
await $`rm -rf ${stageDir}`
await fs.promises.mkdir(stageDir, { recursive: true })
await fs.promises.mkdir(path.join(stageDir, "bin"), { recursive: true })

// Step 3: copy the bundle into stage/bundle.
await $`cp -R ${bundleDir} ${stageDir}/bundle`

// Step 4: write bin/ax-code (sh) and bin/ax-code.cmd (Windows).
await fs.promises.writeFile(path.join(stageDir, "bin/ax-code"), sourceDistributionUnixShim(), { mode: 0o755 })
await fs.promises.writeFile(path.join(stageDir, "bin/ax-code.cmd"), sourceDistributionCmdShim())

// Step 5: write postinstall.mjs.
// At install time we resolve bun once and cache the path, so the shim is
// fast (no PATH lookup or filesystem walk on each invocation).
await fs.promises.writeFile(path.join(stageDir, "bin/postinstall.mjs"), sourceDistributionPostinstall())

// Step 6: write the source-distribution package.json.
//
// Notes on the manifest:
//   - `bun` is a regular dependency so npm always installs the runtime.
//   - OpenTUI's native packages stay optional so npm installs exactly the
//     matching os/cpu package. The bundled JS still resolves that native
//     package dynamically at TUI startup.
//   - No other runtime deps are listed: the bundle inlines them.
//   - `type: module` is required for the postinstall ESM file.
//   - `os` and `cpu` are not constrained: bun handles per-platform
//     selection via its own optionalDependencies tree.
async function removePackedTarballs() {
  for await (const file of new Bun.Glob("*.tgz").scan({ cwd: stageDir })) {
    await fs.promises.rm(path.join(stageDir, file), { force: true })
  }
}

// Step 7: copy LICENSE.
await fs.promises.copyFile(path.resolve(dir, "../../LICENSE"), path.join(stageDir, "LICENSE"))

// Step 8: pack and publish (or just pack when AX_CODE_DRY_RUN=1).
const dryRun = process.env.AX_CODE_DRY_RUN === "1"
if (dryRun) console.log("AX_CODE_DRY_RUN=1 — packing only, not publishing")

for (const packageName of SOURCE_PACKAGE_NAMES) {
  await fs.promises.writeFile(
    path.join(stageDir, "package.json"),
    JSON.stringify(
      sourcePackageManifest({
        packageName,
        version: buildVersion,
        bunDependencyRange: BUN_DEPENDENCY_RANGE,
        opentuiCoreVersion: OPENTUI_CORE_VERSION,
        license: pkg.license,
        sourceDistTag: SOURCE_DIST_TAG,
      }),
      null,
      2,
    ) + "\n",
  )
  await removePackedTarballs()
  await $`npm pack --workspaces=false`.cwd(stageDir)
  if (dryRun) {
    console.log(`Pack complete: ${packageName}@${buildVersion} in ${stageDir}`)
    continue
  }

  const publishResult = await $`npm publish *.tgz --workspaces=false --access public --tag ${SOURCE_DIST_TAG}`
    .cwd(stageDir)
    .nothrow()
  if (publishResult.exitCode !== 0) {
    const stderr = String(publishResult.stderr ?? "")
    if (stderr.includes("previously published") || stderr.includes("cannot publish over")) {
      console.warn(`${packageName}@${buildVersion} (${SOURCE_DIST_TAG}) already published, skipping`)
    } else {
      console.error(stderr)
      process.exit(publishResult.exitCode)
    }
  }

  console.log(`Published ${packageName}@${buildVersion} under tag '${SOURCE_DIST_TAG}'`)
}

if (dryRun) process.exit(0)
