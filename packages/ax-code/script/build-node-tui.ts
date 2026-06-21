import fs from "fs"
import path from "path"
import { createRequire } from "module"
import { fileURLToPath } from "url"
import { spawnSync } from "node:child_process"
import esbuild from "esbuild"
import { SkillLint } from "./check-skills"
import { solidEsbuildPlugin } from "./esbuild-solid-plugin"
import { readText, writeText } from "./fs-compat"
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
  external: ["bun:ffi", "bun:sqlite", "node-pty-prebuilt-multiarch", "@opentui/core", "@opentui/solid"],
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

// Unix launcher: node --experimental-ffi so OpenTUI's node:ffi backend loads.
// --disable-warning=ExperimentalWarning silences Node's "FFI is experimental"
// notice so the shipped binary doesn't print it to stderr on every run.
await writeText(
  path.join(outBin, "ax-code"),
  `#!/bin/sh\nexec node --experimental-ffi --disable-warning=ExperimentalWarning "$(dirname "$0")/../lib/index-node-tui.js" "$@"\n`,
)
await fs.promises.chmod(path.join(outBin, "ax-code"), 0o755)
await writeText(
  path.join(outBin, "ax-code.cmd"),
  `@echo off\r\nset AX_CODE_ORIGINAL_CWD=%CD%\r\nnode --experimental-ffi --disable-warning=ExperimentalWarning "%~dp0..\\lib\\index-node-tui.js" %*\r\n`,
)

// --- Make the distribution self-contained (Bun-free) -----------------------
// The bundle externalizes the native FFI/.node packages and OpenTUI; ship them
// in node_modules beside the bundle so the dist runs anywhere `node` is present.
const deps = pkg.dependencies as Record<string, string>
const distDeps = {
  "@opentui/core": deps["@opentui/core"],
  "@opentui/solid": deps["@opentui/solid"],
  "node-pty-prebuilt-multiarch": deps["node-pty-prebuilt-multiarch"],
  // .wasm files are kept external (esbuild) and resolved at runtime via
  // createRequire — ship the tree-sitter packages beside the bundle so the bash
  // tool's parser finds them.
  "web-tree-sitter": deps["web-tree-sitter"],
  "tree-sitter-bash": deps["tree-sitter-bash"],
}
await writeText(
  path.join(outRoot, "package.json"),
  JSON.stringify({ name: "ax-code-dist", private: true, type: "module", dependencies: distDeps }, null, 2) + "\n",
)
console.log("Installing runtime dependencies (@opentui, node-pty) into the distribution...")
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const install = spawnSync(npm, ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: outRoot, stdio: "inherit" })
if (install.status !== 0) {
  console.error("npm install for the distribution failed")
  process.exit(1)
}

// Re-apply pnpm patches to the freshly npm-installed dist deps. The install
// above pulls @opentui/core et al. clean from the registry, which drops the
// pnpm patches that `pnpm dev` runs with — so without this step the shipped
// binary silently differs from source. Critically it carries the OpenTUI FFI
// coordinate guards; missing them, the TUI throws on every render frame the
// moment a cell scrolls off-screen (negative coord -> strict-u32 FFI reject)
// and spams an unstoppable crash. Overlay each patched file from the (patched)
// workspace copy so the distribution matches source.
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
// node-pty ships a node-gyp addon; build it for this platform (no abi prebuild
// for newer Node yet). Cross-platform builds run this on each target in CI.
const ptyDir = path.join(outRoot, "node_modules", "node-pty-prebuilt-multiarch")
if (fs.existsSync(ptyDir) && !fs.existsSync(path.join(ptyDir, "build", "Release", "pty.node"))) {
  console.log("Building node-pty native addon...")
  const gyp = spawnSync(npm, ["rebuild", "node-pty-prebuilt-multiarch"], { cwd: outRoot, stdio: "inherit" })
  if (gyp.status !== 0) console.warn("node-pty build failed — terminal feature will be unavailable")
}

// Ship the @ax-code napi addons (workspace packages, not on npm) + their .node.
const nativePkgs: Array<[string, string]> = [
  ["fs", path.join(dir, "..", "ax-code-fs-native")],
  ["diff", path.join(dir, "..", "ax-code-diff-native")],
  ["parser", path.join(dir, "..", "ax-code-parser-native")],
  ["index-core", path.join(dir, "..", "ax-code-index-core")],
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
// OpenTUI's .dylib); ad-hoc sign each so the bundle runs after download. Real
// (notarized) signing happens in CI with a Developer ID; ad-hoc keeps local and
// unsigned-CI builds runnable.
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
    const signed = spawnSync("codesign", ["--force", "--sign", "-", lib], { stdio: "inherit" })
    if (signed.status !== 0) console.warn(`codesign failed for ${path.relative(outRoot, lib)}`)
  }
  console.log(`Ad-hoc signed ${nativeLibs.length} native libraries`)
}

if (release) {
  // Archive the WHOLE tree (bin + lib + node_modules), not just bin/ — the
  // node-bundled runtime needs all three beside each other. Zip from the dist
  // root so the archive expands to the same `ax-code-<os>-<arch>/` layout.
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

console.log(`Full Node TUI distribution complete: ${path.relative(dir, outRoot)} (${shippedNative}/4 native addons)`)
console.log(`Run: node --experimental-ffi ${path.relative(dir, path.join(outLib, "index-node-tui.js"))}`)
