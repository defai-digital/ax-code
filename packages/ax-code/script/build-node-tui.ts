import fs from "fs"
import path from "path"
import { createRequire } from "module"
import { fileURLToPath } from "url"
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
const outRoot = path.join(dir, "dist", "ax-code-node-tui")
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
        build.onResolve({ filter: /^bun-pty$/ }, () => ({ path: path.join(dir, "src/pty/bun-pty-node-stub.ts") }))
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
await writeText(
  path.join(outBin, "ax-code"),
  `#!/bin/sh\nexec node --experimental-ffi "$(dirname "$0")/../lib/index-node-tui.js" "$@"\n`,
)
await fs.promises.chmod(path.join(outBin, "ax-code"), 0o755)
await writeText(
  path.join(outBin, "ax-code.cmd"),
  `@echo off\r\nset AX_CODE_ORIGINAL_CWD=%CD%\r\nnode --experimental-ffi "%~dp0..\\lib\\index-node-tui.js" %*\r\n`,
)

console.log(`Full Node TUI build complete: ${path.relative(dir, path.join(outLib, "index-node-tui.js"))}`)
