#!/usr/bin/env bun

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

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
    const sql = await Bun.file(file).text()
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
      const content = await Bun.file(location).text()
      return { location, content }
    }),
  )
})()
console.log(`Loaded ${builtinSkills.length} built-in skills`)

await Bun.build({
  target: "node",
  entrypoints: ["./src/node.ts"],
  outdir: "./dist",
  format: "esm",
  external: ["jsonc-parser"],
  define: {
    AX_CODE_MIGRATIONS: JSON.stringify(migrations),
    AX_CODE_BUILTIN_SKILLS: JSON.stringify(builtinSkills),
  },
})

console.log("Build complete")
