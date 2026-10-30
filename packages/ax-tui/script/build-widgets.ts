import { spawnSync } from "node:child_process"
import { rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const compiler = path.join(root, "node_modules/typescript/bin/tsc")

for (const widget of ["spinner", "chart"]) {
  await rm(path.join(root, widget, "dist"), { recursive: true, force: true })
  const result = spawnSync(process.execPath, [compiler, "-p", `${widget}/tsconfig.build.json`], {
    cwd: root,
    stdio: "inherit",
  })
  if (result.status !== 0) throw result.error ?? new Error(`${widget} build failed`)
}
