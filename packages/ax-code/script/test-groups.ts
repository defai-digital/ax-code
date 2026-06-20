import { spawn } from "child_process"
import { createRequire } from "module"
import path from "path"
import { check, list, pick, root } from "./test-group"

// Resolve the vitest CLI entry from the installed package. vitest's bin
// (./vitest.mjs) isn't exposed via "exports", so resolve the package root and
// join the bin path manually. Spawned with the current node so the runner is
// Bun-free (the per-file timeout lives in vitest.config.ts).
function vitestCli() {
  const require = createRequire(import.meta.url)
  const pkg = require.resolve("vitest/package.json")
  return path.join(path.dirname(pkg), "vitest.mjs")
}

async function main() {
  const name = process.argv[2]
  if (!name) throw new Error("Missing test group")

  const all = await list()
  check(all)
  const next = pick(all, name)
  if (next.length === 0) {
    console.log(`No tests in group: ${name}`)
    return
  }

  console.log(`Running ${name} tests (${next.length})`)
  const proc = spawn(process.execPath, [vitestCli(), "run", ...next], {
    cwd: root,
    stdio: "inherit",
  })
  const code: number = await new Promise((resolve) => {
    proc.on("exit", (value) => resolve(value ?? 1))
    proc.on("error", () => resolve(1))
  })
  process.exit(code)
}

await main()
