#!/usr/bin/env node
// Ensure node-pty's prebuilt POSIX `spawn-helper` is executable after install.
//
// node-pty `posix_spawn`s a small `spawn-helper` binary shipped inside its
// prebuilds. pnpm's content-addressed store does not reliably preserve the
// executable bit on that prebuilt helper, so on a fresh install the desktop
// terminal fails at runtime with "posix_spawnp failed" (EACCES on a
// non-executable helper) even though node-pty itself loads fine. This makes the
// bit deterministic. Idempotent; a no-op on Windows (no spawn-helper there).
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

if (process.platform === "win32") {
  process.exit(0)
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

// Search only inside node-pty package trees to keep the walk cheap and bounded.
const searchRoots = [
  join(repoRoot, "node_modules", ".pnpm"),
  join(repoRoot, "node_modules"),
]

const isNodePtyDir = (name) => name === "node-pty" || name.startsWith("node-pty@") || name.startsWith("node-pty-")

const collectHelpers = (dir, out, depth = 0) => {
  if (depth > 8) return
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectHelpers(full, out, depth + 1)
    } else if (entry.name === "spawn-helper") {
      out.push(full)
    }
  }
}

const helpers = []
for (const searchRoot of searchRoots) {
  let topLevel
  try {
    topLevel = readdirSync(searchRoot, { withFileTypes: true })
  } catch {
    continue
  }
  for (const entry of topLevel) {
    if (entry.isDirectory() && isNodePtyDir(entry.name)) {
      collectHelpers(join(searchRoot, entry.name), helpers)
    }
  }
}

let fixed = 0
for (const helper of new Set(helpers)) {
  try {
    const mode = statSync(helper).mode
    if ((mode & 0o111) !== 0o111) {
      chmodSync(helper, 0o755)
      fixed += 1
    }
  } catch {
    // best-effort; ignore helpers we can't stat/chmod
  }
}

if (fixed > 0) {
  console.log(`[fix-node-pty-permissions] made ${fixed} node-pty spawn-helper binar${fixed === 1 ? "y" : "ies"} executable`)
}
