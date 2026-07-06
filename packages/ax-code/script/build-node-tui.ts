import fs from "fs"
import path from "path"
import { createRequire } from "module"
import { fileURLToPath } from "url"
import { spawnSync } from "node:child_process"
import esbuild from "esbuild"
import { SkillLint } from "./check-skills"
import { collectPackageRuntimeDependencies } from "./build-deps"
import { solidEsbuildPlugin } from "./esbuild-solid-plugin"
import { readText, writeText } from "./fs-compat"
import { WINDOWS_UTF8_WARNING } from "./source-launcher"
import pkg from "../package.json"

// Full Node distribution build INCLUDING the interactive TUI. Bundles
// src/index-node-tui.ts (boot.ts) with esbuild + the OpenTUI Solid JSX plugin.
// OpenTUI core/solid + node-pty stay external (native FFI / .node addons loaded
// at runtime from node_modules shipped beside the bundle); the launcher runs
// node with --experimental-ffi so OpenTUI's node:ffi backend is available.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(__dirname, "..")
const require = createRequire(import.meta.url)
process.chdir(dir)

const buildVersion = (process.env.AX_CODE_VERSION ?? pkg.version).replace(/^v/, "")
const buildChannel = process.env.AX_CODE_CHANNEL ?? "latest"
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
    let real = candidate
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

await fs.promises.rm(outRoot, { recursive: true, force: true })
await fs.promises.mkdir(outBin, { recursive: true })
await fs.promises.mkdir(outLib, { recursive: true })

const result = await esbuild.build({
  entryPoints: [path.join(dir, "src/index-node-tui.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.join(outLib, "index-node-tui.js"),
  conditions: ["node"],
  // Native / Bun-only ids kept external, loaded at runtime from node_modules
  // shipped beside the bundle (OpenTUI FFI lib, node-pty .node, bun:* are
  // never hit on Node).
  external: ["bun:ffi", "bun:sqlite", "node-pty-prebuilt-multiarch", "@ax-code/opentui-core", "@ax-code/opentui-solid"],
  plugins: [
    {
      name: "ax-node-overrides",
      setup(build) {
        build.onResolve({ filter: /^#db$/ }, () => ({ path: path.join(dir, "src/storage/db.node.ts") }))
        // OpenTUI imports solid-js/dist/solid.js directly. Keep the app's bare
        // solid-js imports on that exact external module instance; inlining a
        // second Solid runtime breaks OpenTUI context propagation.
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
    ].join("\n"),
  },
  logLevel: "error",
})
if (result.errors.length > 0) {
  for (const e of result.errors) console.error(e.text)
  process.exit(1)
}

// Bundle the build-time Node runtime so the shipped TUI runs on a pinned Node
// instead of whatever `node` is on the user's PATH (ADR-046 Phase 0). The
// node:ffi backend is experimental and has changed behavior across Node
// releases (u32 argument marshalling); pinning the runtime contains that
// exposure to release time. Cross-arch builds cannot copy a host Node runtime —
// they fall back to the PATH launcher and CI must supply the target runtime.
const bundledNodeDir = path.join(outRoot, "node")
let bundledNode = false
if (process.arch === arch) {
  const nodeRuntime = bundledNodeRuntime!
  // bin/ + lib/ mirrors the source install layout: shared-library Node builds
  // (e.g. Homebrew) are a small bin/node linked against ../lib/libnode.* via
  // @loader_path rpath, so the dylib must ship in the same relative spot.
  // Official release binaries are static — their lib/ has no libnode and only
  // the executable is copied.
  const nodeRealPath = await fs.promises.realpath(nodeRuntime.path)
  await fs.promises.mkdir(path.join(bundledNodeDir, "bin"), { recursive: true })
  await fs.promises.copyFile(nodeRealPath, path.join(bundledNodeDir, "bin", bundledNodeName))
  await fs.promises.chmod(path.join(bundledNodeDir, "bin", bundledNodeName), 0o755)
  const nodeLibDir = path.join(path.dirname(nodeRealPath), "..", "lib")
  const libNodeFiles = fs.existsSync(nodeLibDir)
    ? (await fs.promises.readdir(nodeLibDir)).filter((f) => /^libnode\./.test(f))
    : []
  for (const lib of libNodeFiles) {
    await fs.promises.mkdir(path.join(bundledNodeDir, "lib"), { recursive: true })
    await fs.promises.copyFile(path.join(nodeLibDir, lib), path.join(bundledNodeDir, "lib", lib))
  }
  bundledNode = true
  console.log(
    `Bundled Node runtime ${nodeRuntime.version} (${process.platform}-${arch}${libNodeFiles.length ? `, shared: ${libNodeFiles.join(", ")}` : ", static"})`,
  )
} else {
  console.warn(
    `Cross-arch build (${process.arch} -> ${arch}): skipping bundled Node runtime; launcher will use PATH node`,
  )
}

// Launchers prefer the bundled runtime; AX_CODE_SYSTEM_NODE=1 forces the PATH
// node (support/debug escape hatch), which also remains the fallback when no
// runtime ships beside the bundle. --disable-warning=ExperimentalWarning
// silences Node's "FFI is experimental" notice on every run.
const nodeArgs = `--experimental-ffi --disable-warning=ExperimentalWarning`
await writeText(
  path.join(outBin, "ax-code"),
  [
    `#!/bin/sh`,
    `dir="$(dirname "$0")"`,
    `if [ -z "$AX_CODE_SYSTEM_NODE" ] && [ -x "$dir/../node/bin/node" ]; then`,
    `  exec "$dir/../node/bin/node" ${nodeArgs} "$dir/../lib/index-node-tui.js" "$@"`,
    `fi`,
    `exec node ${nodeArgs} "$dir/../lib/index-node-tui.js" "$@"`,
    ``,
  ].join("\n"),
)
await fs.promises.chmod(path.join(outBin, "ax-code"), 0o755)
await writeText(
  path.join(outBin, "ax-code.cmd"),
  [
    `@echo off`,
    `set AX_CODE_ORIGINAL_CWD=%CD%`,
    `${WINDOWS_UTF8_WARNING.replaceAll("\n", "\r\n")}if not defined AX_CODE_SYSTEM_NODE if exist "%~dp0..\\node\\bin\\node.exe" (`,
    `  "%~dp0..\\node\\bin\\node.exe" ${nodeArgs} "%~dp0..\\lib\\index-node-tui.js" %*`,
    `  exit /b %ERRORLEVEL%`,
    `)`,
    `node ${nodeArgs} "%~dp0..\\lib\\index-node-tui.js" %*`,
    ``,
  ].join("\r\n"),
)

// --- Make the distribution self-contained (Bun-free) -----------------------
// The bundle externalizes the native FFI/.node packages and OpenTUI; ship them
// in node_modules beside the bundle so the dist runs anywhere `node` is present.
const deps = pkg.dependencies as Record<string, string>
// Read the vendored opentui-core's optionalDependencies to find the native platform packages.
const opentuiCorePkg = JSON.parse(fs.readFileSync(path.join(dir, "..", "opentui-core", "package.json"), "utf8")) as {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}
const opentuiSolidPkg = JSON.parse(fs.readFileSync(path.join(dir, "..", "opentui-solid", "package.json"), "utf8")) as {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}
const opentuiSpinnerPkg = JSON.parse(
  fs.readFileSync(path.join(dir, "..", "opentui-spinner", "package.json"), "utf8"),
) as {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}
const currentNativePkg = Object.keys(opentuiCorePkg.optionalDependencies ?? {}).find((name) =>
  name.includes(`-${process.platform}-${process.arch}`),
)
const distDeps: Record<string, string> = {
  ...collectPackageRuntimeDependencies([opentuiCorePkg, opentuiSolidPkg, opentuiSpinnerPkg]),
  "node-pty-prebuilt-multiarch": deps["node-pty-prebuilt-multiarch"],
  // .wasm files are kept external (esbuild) and resolved at runtime via
  // createRequire — ship the tree-sitter packages beside the bundle so the bash
  // tool's parser finds them.
  "web-tree-sitter": deps["web-tree-sitter"],
  "tree-sitter-bash": deps["tree-sitter-bash"],
}
// The vendored @ax-code/opentui-core dynamically imports @opentui/core-<platform>
// for the native .dylib/.so. Ship the matching platform package.
if (currentNativePkg) {
  distDeps[currentNativePkg] = opentuiCorePkg.optionalDependencies![currentNativePkg]
}
// @ax-code/opentui-* are workspace packages (not on npm); copy them directly
// into the distribution instead of npm install.
const vendoredOpentuiPackages: Array<[string, string]> = [
  ["@ax-code/opentui-core", path.join(dir, "..", "opentui-core")],
  ["@ax-code/opentui-solid", path.join(dir, "..", "opentui-solid")],
  ["@ax-code/opentui-spinner", path.join(dir, "..", "opentui-spinner")],
]
await writeText(
  path.join(outRoot, "package.json"),
  JSON.stringify({ name: "ax-code-dist", private: true, type: "module", dependencies: distDeps }, null, 2) + "\n",
)
console.log("Installing runtime dependencies (node-pty, tree-sitter) into the distribution...")
const runNpm = (args: string[]) =>
  spawnSync("npm", args, { cwd: outRoot, stdio: "inherit", shell: process.platform === "win32" })
const install = runNpm(["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"])
if (install.status !== 0) {
  console.error("npm install for the distribution failed")
  if (install.error) console.error(install.error)
  process.exit(1)
}

// Re-apply pnpm patches to the freshly npm-installed dist deps. The install
// above pulls deps clean from the registry, which drops the
// pnpm patches that `pnpm dev` runs with — so without this step the shipped
// binary silently differs from source.
const rootPkg = JSON.parse(await readText(path.join(dir, "..", "..", "package.json"))) as {
  pnpm?: { patchedDependencies?: Record<string, string> }
}
for (const [spec, patchRel] of Object.entries(rootPkg.pnpm?.patchedDependencies ?? {})) {
  const name = spec.replace(/@[^@/]+$/, "") // strip the trailing @version
  if (!(name in distDeps)) continue // only deps shipped beside the bundle need overlaying
  // Resolve the workspace copy via its node_modules path rather than
  // require.resolve(`${name}/package.json`): packages restrict that subpath in
  // their exports map, which throws ERR_PACKAGE_PATH_NOT_EXPORTED.
  const pkgRoot = path.join(dir, "node_modules", ...name.split("/"))
  if (!fs.existsSync(pkgRoot)) {
    console.warn(`Cannot resolve patched dep ${name} to overlay into the distribution`)
    continue
  }
  const patchText = await readText(path.join(dir, "..", "..", patchRel))
  const files = [...patchText.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1].trim())
  for (const rel of files) {
    const src = path.join(pkgRoot, rel)
    const dest = path.join(outRoot, "node_modules", name, rel)
    if (!fs.existsSync(src)) {
      console.warn(`Patched file missing in workspace copy: ${name}/${rel}`)
      continue
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
  console.log(`Re-applied pnpm patch for ${name} (${files.length} file(s)) into the distribution`)
}

// Copy vendored @ax-code/opentui-* workspace packages into the distribution.
// These are not on npm, so they cannot be installed via npm install.
const distAxScope = path.join(outRoot, "node_modules", "@ax-code")
fs.mkdirSync(distAxScope, { recursive: true })
for (const [pkgName, srcDir] of vendoredOpentuiPackages) {
  const destDir = path.join(distAxScope, pkgName.replace("@ax-code/", ""))
  if (!fs.existsSync(srcDir)) {
    console.warn(`Vendored package missing: ${srcDir} — ${pkgName} will be unavailable in the distribution`)
    continue
  }
  fs.cpSync(srcDir, destDir, {
    recursive: true,
    dereference: true,
    filter: (src) => path.basename(src) !== "node_modules",
  })
  console.log(`Copied vendored ${pkgName} into the distribution`)
}
// node-pty ships a node-gyp addon; build it for this platform (no abi prebuild
// for newer Node yet). Cross-platform builds run this on each target in CI.
const ptyDir = path.join(outRoot, "node_modules", "node-pty-prebuilt-multiarch")
if (fs.existsSync(ptyDir) && !fs.existsSync(path.join(ptyDir, "build", "Release", "pty.node"))) {
  console.log("Building node-pty native addon...")
  const gyp = runNpm(["rebuild", "node-pty-prebuilt-multiarch"])
  if (gyp.status !== 0) console.warn("node-pty build failed — terminal feature will be unavailable")
}

// Ship the @ax-code napi addons (workspace packages, not on npm) + their .node.
const nativePkgs: Array<[string, string]> = [
  ["fs", path.join(dir, "..", "ax-code-fs-native")],
  ["diff", path.join(dir, "..", "ax-code-diff-native")],
  ["parser", path.join(dir, "..", "ax-code-parser-native")],
  ["index-core", path.join(dir, "..", "ax-code-index-core")],
  ["render", path.join(dir, "..", "ax-code-render-native")],
]
const axScope = path.join(outRoot, "node_modules", "@ax-code")
fs.mkdirSync(axScope, { recursive: true })
let shippedNative = 0
for (const [name, src] of nativePkgs) {
  if (!fs.existsSync(src)) {
    console.warn(`native addon source missing: ${src} (run pnpm build:native) — ${name} will fall back to JS`)
    continue
  }
  fs.cpSync(src, path.join(axScope, name), { recursive: true, dereference: true })
  shippedNative++
}

// macOS Gatekeeper rejects unsigned native code. Unlike the single Bun-SEA
// binary, a node-bundled dist carries many native libraries (.node addons and
// OpenTUI's .dylib). Release CI passes AX_CODE_APPLE_CODESIGN_IDENTITY after
// importing the Developer ID certificate; local and fork builds fall back to
// ad-hoc signatures so the bundle remains runnable without Apple secrets. The
// bundled Node runtime under node/ is deliberately NOT re-signed: official Node
// releases already ship with their own Developer ID signature, and local Node
// builds may require entitlements we should not overwrite.
if (process.platform === "darwin") {
  const nativeLibs: string[] = []
  const walk = (root: string) => {
    if (!fs.existsSync(root)) return
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith(".node") || entry.name.endsWith(".dylib")) nativeLibs.push(full)
    }
  }
  walk(path.join(outRoot, "node_modules"))
  for (const lib of nativeLibs) {
    const signArgs = appleCodesignIdentity
      ? ["--force", "--timestamp", "--options", "runtime", "--sign", appleCodesignIdentity, lib]
      : ["--force", "--sign", "-", lib]
    const signed = spawnSync("codesign", signArgs, { stdio: "inherit" })
    if (signed.status !== 0) {
      const message = `codesign failed for ${path.relative(outRoot, lib)}`
      if (appleCodesignIdentity) {
        console.error(message)
        process.exit(1)
      }
      console.warn(message)
      continue
    }
    const verified = spawnSync("codesign", ["--verify", "--strict", lib], { stdio: "inherit" })
    if (verified.status !== 0) {
      const message = `codesign verification failed for ${path.relative(outRoot, lib)}`
      if (appleCodesignIdentity) {
        console.error(message)
        process.exit(1)
      }
      console.warn(message)
    }
  }
  console.log(
    `${appleCodesignIdentity ? "Developer ID signed" : "Ad-hoc signed"} ${nativeLibs.length} native libraries`,
  )
}

if (release) {
  // Archive the WHOLE tree (bin + lib + node_modules + node/), not just bin/ —
  // the node-bundled runtime needs them all beside each other. Zip from the
  // dist root so the archive expands to the same `ax-code-<os>-<arch>/` layout.
  const archive = path.join(dir, "dist", `${legacyName}.zip`)
  fs.rmSync(archive, { force: true })
  const zipper =
    process.platform === "win32"
      ? spawnSync(
          "powershell",
          ["-Command", `Compress-Archive -Path '${outRoot}/*' -DestinationPath '${archive}' -Force`],
          { stdio: "inherit" },
        )
      : spawnSync("zip", ["-r", "-y", archive, "."], { cwd: outRoot, stdio: "inherit" })
  if (zipper.status !== 0) {
    console.error(`failed to archive ${legacyName}`)
    process.exit(1)
  }
  console.log(`Release archive: ${path.relative(dir, archive)}`)
}

console.log(
  `Full Node TUI distribution complete: ${path.relative(dir, outRoot)} (${shippedNative}/${nativePkgs.length} native addons, bundled node: ${bundledNode ? process.version : "none"})`,
)
console.log(`Run: ${path.relative(dir, path.join(outBin, "ax-code"))}`)
