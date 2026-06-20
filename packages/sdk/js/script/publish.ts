#!/usr/bin/env -S npx tsx

import { Script } from "@ax-code/script"
import { spawnSync } from "child_process"
import fs from "fs/promises"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

function sh(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { cwd: dir, stdio: "inherit", shell: process.platform === "win32" })
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${result.status}`)
}

const pkg = (await import("../package.json").then((m) => m.default)) as {
  exports: Record<string, string | object>
}
const original = JSON.parse(JSON.stringify(pkg))
function transformExports(exports: Record<string, string | object>) {
  for (const [key, value] of Object.entries(exports)) {
    if (typeof value === "object" && value !== null) {
      transformExports(value as Record<string, string | object>)
    } else if (typeof value === "string" && value.endsWith(".ts")) {
      const file = value.replace("./src/", "./dist/").replace(".ts", "")
      exports[key] = {
        import: file + ".js",
        types: file + ".d.ts",
      }
    }
  }
}
transformExports(pkg.exports)
await fs.writeFile("package.json", JSON.stringify(pkg, null, 2))
sh("npm", ["pack", "--workspaces=false"])
// Resolve the packed tarball explicitly — spawnSync without a shell does not
// expand the `*.tgz` glob the Bun `$` template used to.
const tarballs = (await fs.readdir(dir)).filter((file) => file.endsWith(".tgz"))
sh("npm", ["publish", ...tarballs, "--workspaces=false", "--tag", Script.channel, "--access", "public"])
await fs.writeFile("package.json", JSON.stringify(original, null, 2))
