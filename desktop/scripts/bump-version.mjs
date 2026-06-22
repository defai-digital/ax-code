#!/usr/bin/env node
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP_ROOT = path.resolve(__dirname, "..")

const PACKAGES = ["packages/ui/package.json", "packages/web/package.json", "packages/electron/package.json"]

const newVersion = process.argv[2]
if (!newVersion || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(newVersion)) {
  console.error("Usage: node scripts/bump-version.mjs <version>")
  console.error("Example: node scripts/bump-version.mjs 0.2.0")
  console.error("Example: node scripts/bump-version.mjs 0.2.0-beta.1")
  process.exit(1)
}

console.log(`Bumping version to ${newVersion}\n`)

// Update package.json files
for (const pkgPath of PACKAGES) {
  const fullPath = path.join(DESKTOP_ROOT, pkgPath)
  if (!fs.existsSync(fullPath)) {
    console.log(`  ${pkgPath}: not present, skipping`)
    continue
  }
  const pkg = JSON.parse(fs.readFileSync(fullPath, "utf8"))
  const oldVersion = pkg.version
  pkg.version = newVersion
  fs.writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + "\n")
  console.log(`  ${pkgPath}: ${oldVersion} -> ${newVersion}`)
}

console.log(`\nVersion bumped to ${newVersion}`)
console.log("\nNext steps:")
console.log(`  git add -A`)
console.log(`  git commit -m "release desktop v${newVersion}"`)
console.log(`  git tag desktop-v${newVersion}`)
console.log(`  git push origin main --tags`)
