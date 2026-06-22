#!/usr/bin/env node
/**
 * Copies the Vite-built web UI (packages/web/dist) into
 * packages/electron/resources/web-dist so electron-builder can
 * include it as an extraResource in the final package.
 */
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "../../..")

const src = path.join(root, "packages/web/dist")
const dest = path.join(__dirname, "../resources/web-dist")

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true })
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const srcPath = path.join(from, entry.name)
    const dstPath = path.join(to, entry.name)
    if (entry.isDirectory()) {
      await copyDir(srcPath, dstPath)
    } else {
      await fs.copyFile(srcPath, dstPath)
    }
  }
}

await fs.rm(dest, { recursive: true, force: true })
await copyDir(src, dest)
console.log(`[electron] web assets → ${path.relative(root, dest)}`)
