import fs from "fs"
import path from "path"
import { createHash } from "node:crypto"
import { createRequire } from "module"
import { fileURLToPath } from "url"
import { spawnSync } from "node:child_process"
import esbuild from "esbuild"
import { SkillLint } from "./check-skills"
import { collectPackageRuntimeDependencies, resolveInstalledPackagePath } from "./build-deps"
import { solidEsbuildPlugin } from "./esbuild-solid-plugin"
import { readText, writeText } from "./fs-compat"
import { resolveLegacyNodeGypPython } from "./node-gyp-python"
import { unixNodeLauncherScript, windowsNodeLauncherScript } from "./node-launcher"
import { copyTuiDistPackage, toTuiDistPackageJson, withoutTuiTransformDependencies } from "./tui-dist"
import pkg from "../package.json"

// Full Node distribution build INCLUDING the interactive TUI. Bundles
// src/index-node-tui.ts (boot.ts) with esbuild + the AX Code TUI Solid JSX plugin.
// AX Code TUI + node-pty stay external (native FFI / .node addons loaded
// at runtime from node_modules shipped beside the bundle); the launcher runs
// node with --experimental-ffi so AX Code TUI's node:ffi backend is available.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(__dirname, "..")
const require = createRequire(import.meta.url)
const { writeRuntimeManifest } = require(path.join(__dirname, "..", "..", "..", "script", "runtime-manifest.cjs")) as {
  writeRuntimeManifest: (runtimeRoot: string) => {
    files: Array<
      { path: string; type: "file"; size: number; sha256: string } | { path: string; type: "symlink"; target: string }
    >
  }
}
process.chdir(dir)

function buildChannelForVersion(version: string) {
  const prerelease = version.split("-", 2)[1]
  if (!prerelease) return "latest"
  return prerelease.split(".", 1)[0] || "beta"
}

const buildVersion = (process.env.AX_CODE_VERSION ?? pkg.version).replace(/^v/, "")
// Derive the channel from the version's prerelease tag when AX_CODE_CHANNEL
// isn't set, matching build-node.ts — otherwise a local/prerelease build
// silently embeds AX_CODE_CHANNEL="latest" and the shipped binary checks the
// wrong auto-update channel (Installation.CHANNEL, src/installation/index.ts).
const buildChannel = process.env.AX_CODE_CHANNEL ?? buildChannelForVersion(buildVersion)
const appleCodesignIdentity = process.env.AX_CODE_APPLE_CODESIGN_IDENTITY?.trim()
const solidStoreClientEntry = require.resolve("solid-js/store/dist/store.js")
const solidWebClientEntry = require.resolve("solid-js/web/dist/web.js")

// Distribution name mirrors the legacy compiled artifacts (ax-code-<os>-<arch>)
// so the release upload, Homebrew formula, and install scripts keep the same
// asset names after the move from Bun-SEA to node-bundled. `--release` zips the
// whole tree (bin + lib + node_modules) for upload; without it the build is a
// convenient local dist under the same arch-named directory.
const archFlagIndex = process.argv.indexOf("--arch")
const arch = (archFlagIndex >= 0 ? process.argv[archFlagIndex + 1] : process.arch) as "x64" | "arm64"
if (arch !== "x64" && arch !== "arm64") throw new Error(`Unsupported Node TUI distribution architecture: ${arch}`)
const platform = process.platform === "win32" ? "windows" : process.platform
const release = process.argv.includes("--release")
const legacyName = `${pkg.name}-${platform}-${arch}`
const outRoot = path.join(dir, "dist", legacyName)
const outBin = path.join(outRoot, "bin")
const outLib = path.join(outRoot, "lib")
const bundledNodeName = process.platform === "win32" ? "node.exe" : "node"

type FfiNodeRuntime = {
  path: string
  version: string
  platform: NodeJS.Platform
  arch: NodeJS.Architecture
}

function inspectFfiNodeRuntime(nodePath: string): FfiNodeRuntime | undefined {
  const result = spawnSync(
    nodePath,
    [
      "--experimental-ffi",
      "--disable-warning=ExperimentalWarning",
      "-e",
      "require('node:ffi'); process.stdout.write([process.version, process.platform, process.arch].join('\\n'))",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
    },
  )
  if (result.status !== 0) return undefined
  const [version, runtimePlatform, runtimeArch] = String(result.stdout).trim().split("\n")
  if (!version || !runtimePlatform || !runtimeArch) return undefined
  return {
    path: nodePath,
    version,
    platform: runtimePlatform as NodeJS.Platform,
    arch: runtimeArch as NodeJS.Architecture,
  }
}

function candidateNodeRuntimePaths() {
  const candidates = [
    process.execPath,
    ...String(process.env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((entry) => path.join(entry, bundledNodeName)),
  ].filter((value): value is string => typeof value === "string" && value.length > 0)

  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    let real: string
    try {
      real = fs.realpathSync(candidate)
    } catch {
      return false
    }
    if (seen.has(real)) return false
    seen.add(real)
    return true
  })
}

function resolveBundledNodeRuntime(targetArch: "x64" | "arm64") {
  const explicit = process.env.AX_CODE_BUNDLED_NODE
  if (explicit) {
    const runtime = inspectFfiNodeRuntime(explicit)
    if (!runtime) {
      throw new Error(`AX_CODE_BUNDLED_NODE does not support node:ffi: ${explicit}`)
    }
    if (runtime.platform !== process.platform || runtime.arch !== targetArch) {
      throw new Error(
        `AX_CODE_BUNDLED_NODE resolved to ${runtime.version} ${runtime.platform}-${runtime.arch}, expected ${process.platform}-${targetArch}: ${explicit}`,
      )
    }
    return runtime
  }

  const inspected: string[] = []
  for (const candidate of candidateNodeRuntimePaths()) {
    const runtime = inspectFfiNodeRuntime(candidate)
    if (!runtime) {
      inspected.push(`${candidate} (no node:ffi support)`)
      continue
    }
    if (runtime.platform !== process.platform || runtime.arch !== targetArch) {
      inspected.push(
        `${candidate} (${runtime.version} ${runtime.platform}-${runtime.arch}, expected ${process.platform}-${targetArch})`,
      )
      continue
    }
    return runtime
  }

  throw new Error(
    [
      `Node TUI bundled builds require a Node runtime with node:ffi support for ${process.platform}-${targetArch}.`,
      "Run the build with Node 26+, or set AX_CODE_BUNDLED_NODE to a Node 26+ executable.",
      inspected.length ? `Inspected candidates:\n  - ${inspected.join("\n  - ")}` : "No Node candidates were found.",
    ].join("\n"),
  )
}

const bundledNodeRuntime = process.arch === arch ? resolveBundledNodeRuntime(arch) : undefined

const migrationDirs = (await fs.promises.readdir(path.join(dir, "migration"), { withFileTypes: true }))
  .filter((e) => e.isDirectory() && /^\d{14}/.test(e.name))
  .map((e) => e.name)
  .sort()
const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const sql = await readText(path.join(dir, "migration", name, "migration.sql"))
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

const skillsDir = path.join(dir, "skills")
const builtinSkills = await Promise.all(
  (await fs.promises.readdir(skillsDir, { withFileTypes: true }).catch(() => [] as fs.Dirent[]))
    .filter((e) => e.isDirectory())
    .map(async (e) => {
      const location = path.join(skillsDir, e.name, "SKILL.md")
      return { location, content: await readText(location) }
    }),
)
const skillIssues = await SkillLint.check(skillsDir)
if (skillIssues.length > 0) {
  console.error("Built-in skill validation failed:")
  for (const { skill, problems } of skillIssues) for (const p of problems) console.error(`  - ${skill}: ${p}`)
  process.exit(1)
}
console.log(`Loaded ${builtinSkills.length} built-in skills`)

// Preserve existing builds.
await fs.promises.mkdir(outBin, { recursive: true })
await fs.promises.mkdir(outLib, { recursive: true })

const result = await esbuild.build({
  entryPoints: [path.join(dir, "src/index-node-tui.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.resolve(dir, "../../../upgrade-7.15.1/stage/lib/history-candidate.js"),
  conditions: ["node"],
  // Native / Bun-only ids kept external, loaded at runtime from node_modules
  // shipped beside the bundle (TUI FFI lib, node-pty .node, bun:* are
  // never hit on Node). Do not inline ax-tui: the native
  // library and tree-sitter assets resolve via import.meta.url on the
  // hashed vendor chunks. Bundling a narrow source entry is a follow-up
  // (see the ax-tui repo's MAINTENANCE.md).
  external: ["bun:ffi", "bun:sqlite", "node-pty-prebuilt-multiarch", "ax-tui", "ax-tui/*"],
  plugins: [
    {
      name: "ax-node-overrides",
      setup(build) {
        build.onResolve({ filter: /^#db$/ }, () => ({ path: path.join(dir, "src/storage/db.node.ts") }))
        // AX Code TUI imports solid-js/dist/solid.js directly. Keep the app's bare
        // solid-js imports on that exact external module instance; inlining a
        // second Solid runtime breaks TUI context propagation.
        build.onResolve({ filter: /^solid-js$/ }, () => ({ path: "solid-js/dist/solid.js", external: true }))
        build.onResolve({ filter: /^solid-js\/store$/ }, () => ({ path: solidStoreClientEntry }))
        build.onResolve({ filter: /^solid-js\/web$/ }, () => ({ path: solidWebClientEntry }))
        build.onResolve({ filter: /^drizzle-orm\/bun-sqlite$/ }, () => ({
          path: require.resolve("drizzle-orm/node-sqlite"),
        }))
        build.onResolve({ filter: /^drizzle-orm\/bun-sqlite\/migrator$/ }, () => ({
          path: require.resolve("drizzle-orm/node-sqlite/migrator"),
        }))
        build.onResolve({ filter: /\.wasm$/ }, () => ({ external: true }))
        build.onResolve({ filter: /^jsonc-parser$/ }, () => ({
          path: path.join(dir, "node_modules/jsonc-parser/lib/esm/main.js"),
        }))
      },
    },
    solidEsbuildPlugin(),
  ],
  define: {
    AX_CODE_VERSION: JSON.stringify(buildVersion),
    AX_CODE_CHANNEL: JSON.stringify(buildChannel),
    AX_CODE_MIGRATIONS: JSON.stringify(migrations),
    AX_CODE_BUILTIN_SKILLS: JSON.stringify(builtinSkills),
    AX_CODE_LIBC: '""',
  },
  banner: {
    js: [
      "import { createRequire as __cr } from 'node:module';",
      "import { fileURLToPath as __f2p } from 'node:url';",
      "import { dirname as __dn } from 'node:path';",
      "const require = __cr(import.meta.url);",
      "const __filename = __f2p(import.meta.url);",
      "const __dirname = __dn(__filename);",
      `globalThis.AX_CODE_BUILTIN_SKILLS = ${JSON.stringify(builtinSkills)};`,
    ].join("\n"),
  },
  logLevel: "error",
})
