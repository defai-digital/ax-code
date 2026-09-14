import fs from "fs"
import path from "path"
import { createRequire } from "module"
import { fileURLToPath } from "url"
import esbuild from "esbuild"
import { SkillLint } from "./check-skills"
import { solidEsbuildPlugin } from "./esbuild-solid-plugin"
import { readText } from "./fs-compat"
import pkg from "../package.json"

// Full Node distribution build INCLUDING the interactive TUI. Bundles
// src/index-node-tui.ts (boot.ts) with esbuild + the AX Code TUI Solid JSX plugin.
// AX Code TUI + node-pty stay external (native FFI / .node addons loaded
// at runtime from node_modules shipped beside the bundle); the launcher runs
// node with --experimental-ffi so AX Code TUI's node:ffi backend is available.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(__dirname, "..")
const require = createRequire(import.meta.url)
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

// Preserve existing builds.
await fs.promises.mkdir(outBin, { recursive: true })
await fs.promises.mkdir(outLib, { recursive: true })

await esbuild.build({
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
