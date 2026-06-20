import fs from "fs"
import path from "path"
import { createRequire } from "module"
import { fileURLToPath } from "url"
import esbuild from "esbuild"
import { SkillLint } from "./check-skills"
import { readText, writeText } from "./fs-compat"
import { capture } from "./proc-compat"
import pkg from "../package.json"

// Windows node-bundled distribution build. Uses esbuild (not Bun.build) so the
// build toolchain runs under plain Node/tsx — no Bun. The node entry
// (index-node.ts → boot-node) is the headless/diagnostic runtime; the full
// OpenTUI TUI still ships via the Bun compiled binary until it runs under Node.

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")
const require = createRequire(import.meta.url)

process.chdir(dir)

const releaseFlag = process.env.AX_CODE_RELEASE === "1" || process.env.AX_CODE_RELEASE === "true"
const archFlagIndex = process.argv.indexOf("--arch")
const arch = (archFlagIndex >= 0 ? process.argv[archFlagIndex + 1] : process.arch) as "x64" | "arm64"
if (arch !== "x64" && arch !== "arm64") {
  throw new Error(`Unsupported Windows Node distribution architecture: ${arch}`)
}

function buildChannelForVersion(version: string) {
  const prerelease = version.split("-", 2)[1]
  if (!prerelease) return "latest"
  return prerelease.split(".", 1)[0] || "beta"
}

const buildVersion = (process.env.AX_CODE_VERSION ?? pkg.version).replace(/^v/, "")
const buildChannel = process.env.AX_CODE_CHANNEL ?? buildChannelForVersion(buildVersion)
const legacyName = `${pkg.name}-windows-${arch}`
const outRoot = path.join(dir, "dist", legacyName)
const outBin = path.join(outRoot, "bin")
const outLib = path.join(outRoot, "lib")

// Load migrations from migration directories
const migrationDirs = (
  await fs.promises.readdir(path.join(dir, "migration"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await readText(file)
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

const skillsDir = path.join(dir, "skills")
const builtinSkills = await (async () => {
  const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true }).catch(() => [] as fs.Dirent[])
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  return Promise.all(
    dirs.map(async (name) => {
      const location = path.join(skillsDir, name, "SKILL.md")
      const content = await readText(location)
      return { location, content }
    }),
  )
})()
console.log(`Loaded ${builtinSkills.length} built-in skills`)

const skillIssues = await SkillLint.check(skillsDir)
if (skillIssues.length > 0) {
  console.error("Built-in skill validation failed:")
  for (const { skill, problems } of skillIssues) {
    for (const problem of problems) console.error(`  - ${skill}: ${problem}`)
  }
  process.exit(1)
}

await fs.promises.rm(outRoot, { recursive: true, force: true })
await fs.promises.mkdir(outBin, { recursive: true })
await fs.promises.mkdir(outLib, { recursive: true })

const result = await esbuild.build({
  entryPoints: [path.join(dir, "src/index-node.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.join(outLib, "index-node.js"),
  conditions: ["node"],
  // node-pty ships a native .node addon esbuild can't bundle; keep it external,
  // loaded at runtime from node_modules shipped beside the bundle (same as the
  // napi addons and tree-sitter wasm).
  external: ["bun:ffi", "node-pty-prebuilt-multiarch"],
  plugins: [
    {
      name: "ax-node-overrides",
      setup(build) {
        build.onResolve({ filter: /^#db$/ }, () => ({ path: path.join(dir, "src/storage/db.node.ts") }))
        build.onResolve({ filter: /^drizzle-orm\/bun-sqlite$/ }, () => ({
          path: require.resolve("drizzle-orm/node-sqlite"),
        }))
        build.onResolve({ filter: /^drizzle-orm\/bun-sqlite\/migrator$/ }, () => ({
          path: require.resolve("drizzle-orm/node-sqlite/migrator"),
        }))
        // Lazy tree-sitter wasm imports — keep external, resolved at runtime from
        // node_modules shipped beside the bundle.
        build.onResolve({ filter: /\.wasm$/ }, () => ({ external: true }))
        // jsonc-parser's UMD main leaves an unbundled require("./impl/*"); use ESM.
        build.onResolve({ filter: /^jsonc-parser$/ }, () => ({
          path: path.join(dir, "node_modules/jsonc-parser/lib/esm/main.js"),
        }))
      },
    },
  ],
  define: {
    AX_CODE_VERSION: JSON.stringify(buildVersion),
    AX_CODE_CHANNEL: JSON.stringify(buildChannel),
    AX_CODE_MIGRATIONS: JSON.stringify(migrations),
    AX_CODE_BUILTIN_SKILLS: JSON.stringify(builtinSkills),
    AX_CODE_LIBC: '""',
  },
  // ESM output: some CJS deps call require()/__dirname. Bun.build injected these
  // automatically; esbuild needs an explicit banner.
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
  for (const err of result.errors) console.error(err.text)
  process.exit(1)
}

await writeText(
  path.join(outBin, "ax-code.cmd"),
  `@echo off\r\nset AX_CODE_ORIGINAL_CWD=%CD%\r\nnode "%~dp0..\\lib\\index-node.js" %*\r\n`,
)
await writeText(
  path.join(outRoot, "README.txt"),
  [
    "ax-code Windows Node distribution",
    "",
    "This package runs ax-code with the installed Node.js LTS runtime instead of a Bun compiled executable.",
    "Install Node.js 22 or newer, then run bin\\ax-code.cmd.",
    "",
  ].join("\r\n"),
)

if (releaseFlag) {
  const archive = path.resolve(dir, "dist", `${legacyName}.zip`)
  const zip = await capture([
    "powershell",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Compress-Archive -Path '${outRoot}/*' -DestinationPath '${archive}' -Force`,
  ])
  if (zip.code !== 0) {
    console.error(zip.stderr)
    process.exit(1)
  }
}

console.log(`Build complete: ${legacyName}`)
