#!/usr/bin/env bun
// PoC: build a CommonJS bundle of the Node entry suitable for Node SEA.
// Mirrors script/build-node.ts but: format=cjs, wrapped entry (no top-level
// await), and bundles jsonc-parser (SEA can't resolve externals from disk).
import fs from "fs"
import path from "path"
import { createRequire } from "module"
import { fileURLToPath } from "url"
import solidPlugin from "@opentui/solid/bun-plugin"
import pkg from "../package.json"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(__dirname, "..")
const require = createRequire(import.meta.url)
process.chdir(dir)

const buildVersion = (process.env.AX_CODE_VERSION ?? pkg.version).replace(/^v/, "")
const outDir = "/tmp/sea-axcode"
await fs.promises.mkdir(outDir, { recursive: true })

// migrations
const migrationDirs = (await fs.promises.readdir(path.join(dir, "migration"), { withFileTypes: true }))
  .filter((e) => e.isDirectory() && /^\d{14}/.test(e.name))
  .map((e) => e.name)
  .sort()
const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const sql = await Bun.file(path.join(dir, "migration", name, "migration.sql")).text()
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)!
    const timestamp = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
    return { sql, timestamp, name }
  }),
)

// skills
const skillsDir = path.join(dir, "skills")
const skillEntries = await fs.promises.readdir(skillsDir, { withFileTypes: true }).catch(() => [])
const builtinSkills = await Promise.all(
  skillEntries
    .filter((e) => e.isDirectory())
    .map(async (e) => {
      const location = path.join(skillsDir, e.name, "SKILL.md")
      return { location, content: await Bun.file(location).text() }
    }),
)

// CJS entry: wrap in async IIFE so there is no top-level await.
const entryPath = path.join(outDir, "_sea-entry.ts")
await fs.promises.writeFile(
  entryPath,
  `import { installNodeBunCompat } from ${JSON.stringify(path.join(dir, "src/bun/node-compat.ts"))}
async function main() {
  installNodeBunCompat()
  const { hooks, run } = await import(${JSON.stringify(path.join(dir, "src/cli/boot-node.ts"))})
  hooks()
  await run()
}
main().catch((e) => { console.error(e); process.exit(1) })
`,
)

const build = await Bun.build({
  target: "node",
  format: "cjs",
  entrypoints: [entryPath],
  outdir: outDir,
  conditions: ["node"],
  plugins: [
    solidPlugin,
    {
      name: "node-db-condition",
      setup(b) {
        b.onResolve({ filter: /^#db$/ }, () => ({ path: path.join(dir, "src/storage/db.node.ts") }))
        b.onResolve({ filter: /^bun-pty$/ }, () => ({ path: path.join(dir, "src/pty/bun-pty-node-stub.ts") }))
        b.onResolve({ filter: /^drizzle-orm\/bun-sqlite$/ }, () => ({ path: require.resolve("drizzle-orm/node-sqlite") }))
        b.onResolve({ filter: /^drizzle-orm\/bun-sqlite\/migrator$/ }, () => ({
          path: require.resolve("drizzle-orm/node-sqlite/migrator"),
        }))
        // jsonc-parser's UMD main leaves dynamic require("./impl/*") unbundled,
        // which SEA can't resolve. Force the ESM build so it bundles fully.
        b.onResolve({ filter: /^jsonc-parser$/ }, () => ({
          path: path.join(dir, "node_modules/jsonc-parser/lib/esm/main.js"),
        }))
      },
    },
  ],
  external: ["bun:ffi"],
  define: {
    AX_CODE_VERSION: `'${buildVersion}'`,
    AX_CODE_CHANNEL: `'latest'`,
    AX_CODE_MIGRATIONS: JSON.stringify(migrations),
    AX_CODE_BUILTIN_SKILLS: JSON.stringify(builtinSkills),
    AX_CODE_LIBC: "''",
  },
})

if (!build.success) {
  for (const l of build.logs) console.error(l.message)
  process.exit(1)
}
console.log("CJS bundle written to", outDir)
for (const o of build.outputs) console.log("  ", path.basename(o.path), (o.size / 1e6).toFixed(1) + "MB")
