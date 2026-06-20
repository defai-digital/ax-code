#!/usr/bin/env node
// Bun-free Node build (ADR-036 P4): bundles the Node entrypoint with esbuild
// instead of Bun.build, so the build toolchain no longer requires Bun. Runs
// under plain `node`. The headless Node entry pulls in no Solid/TUI .tsx, so no
// JSX plugin is needed — only the #db and bun-pty resolve overrides that
// build-node.ts applies.
import esbuild from "esbuild"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
process.chdir(dir)

const version = (process.env.AX_CODE_VERSION ?? "6.6.0").replace(/^v/, "")
const channel = process.env.AX_CODE_CHANNEL ?? "latest"
const outDir = path.join(dir, "dist", "ax-code-node", "lib")
fs.mkdirSync(outDir, { recursive: true })

// migrations
const migDirs = fs
  .readdirSync(path.join(dir, "migration"), { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^\d{14}/.test(e.name))
  .map((e) => e.name)
  .sort()
const migrations = migDirs.map((name) => {
  const sql = fs.readFileSync(path.join(dir, "migration", name, "migration.sql"), "utf8")
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
  const timestamp = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0
  return { sql, timestamp, name }
})

// skills
const skillsDir = path.join(dir, "skills")
const builtinSkills = (fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir, { withFileTypes: true }) : [])
  .filter((e) => e.isDirectory())
  .map((e) => {
    const location = path.join(skillsDir, e.name, "SKILL.md")
    return { location, content: fs.readFileSync(location, "utf8") }
  })

const resolveOverrides = {
  name: "ax-node-overrides",
  setup(build) {
    build.onResolve({ filter: /^#db$/ }, () => ({ path: path.join(dir, "src/storage/db.node.ts") }))
    build.onResolve({ filter: /^bun-pty$/ }, () => ({ path: path.join(dir, "src/pty/bun-pty-node-stub.ts") }))
    // json-migration.ts pulls drizzle's bun-sqlite driver; use the node driver.
    build.onResolve({ filter: /^drizzle-orm\/bun-sqlite$/ }, () => ({
      path: require.resolve("drizzle-orm/node-sqlite"),
    }))
    // esbuild can't bundle `import(... , { with: { type: "wasm" } })`. These are
    // lazy (tree-sitter parser init); leave them as runtime imports resolved
    // from node_modules shipped beside the bundle.
    build.onResolve({ filter: /\.wasm$/ }, () => ({ external: true }))
    // jsonc-parser's UMD main leaves an unbundled require("./impl/*"); use ESM.
    build.onResolve({ filter: /^jsonc-parser$/ }, () => ({
      path: path.join(dir, "node_modules/jsonc-parser/lib/esm/main.js"),
    }))
  },
}

const result = await esbuild.build({
  entryPoints: [path.join(dir, "src/index-node.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.join(outDir, "index-node.js"),
  conditions: ["node"],
  external: ["bun:ffi"],
  plugins: [resolveOverrides],
  define: {
    AX_CODE_VERSION: JSON.stringify(version),
    AX_CODE_CHANNEL: JSON.stringify(channel),
    AX_CODE_MIGRATIONS: JSON.stringify(migrations),
    AX_CODE_BUILTIN_SKILLS: JSON.stringify(builtinSkills),
    AX_CODE_LIBC: '""',
  },
  logLevel: "error",
  metafile: false,
  // ESM output: some CJS deps call require()/__dirname. Bun.build injects these
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
})

const launcher = path.join(dir, "dist", "ax-code-node", "bin")
fs.mkdirSync(launcher, { recursive: true })
fs.writeFileSync(path.join(launcher, "ax-code"), `#!/bin/sh\nexec node "$(dirname "$0")/../lib/index-node.js" "$@"\n`, {
  mode: 0o755,
})

console.log(`Bun-free node build complete (esbuild): ${migrations.length} migrations, ${builtinSkills.length} skills`)
console.log(`  warnings: ${result.warnings.length}`)
console.log(`  output: ${path.relative(dir, path.join(outDir, "index-node.js"))}`)
