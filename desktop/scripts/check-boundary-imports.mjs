import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repositoryRoot = path.resolve(desktopRoot, "..")
const checker = path.join(repositoryRoot, "script/check-desktop-boundaries.ts")

// Keep the historical Desktop-local entrypoint, but delegate policy to the
// repository checker so the two commands cannot drift apart.
const result = spawnSync(process.execPath, ["--import", "tsx", checker, ...process.argv.slice(2)], {
  cwd: repositoryRoot,
  stdio: "inherit",
})

if (result.error) throw result.error
process.exitCode = result.status ?? 1
