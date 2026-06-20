#!/usr/bin/env -S npx tsx
import { Script } from "@ax-code/script"
import { spawnSync } from "child_process"
import fs from "fs/promises"
import { readdirSync } from "fs"
import { fileURLToPath } from "url"
import path from "path"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

function sh(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { cwd: dir, stdio: "inherit", shell: process.platform === "win32" })
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${result.status}`)
}

sh(path.join(dir, "node_modules", ".bin", "tsc"), [])
const pkg = await import("../package.json").then((m) => m.default)
const original = JSON.parse(JSON.stringify(pkg))
for (const [key, value] of Object.entries(pkg.exports)) {
  const file = (value as string).replace("./src/", "./dist/").replace(".ts", "")
  // @ts-ignore
  pkg.exports[key] = {
    import: file + ".js",
    types: file + ".d.ts",
  }
}
await fs.writeFile("package.json", JSON.stringify(pkg, null, 2))
sh("npm", ["pack", "--workspaces=false"])
// Resolve the packed tarball explicitly (spawnSync has no shell glob expansion).
const tarballs = readdirSync(dir).filter((file) => file.endsWith(".tgz"))
sh("npm", ["publish", ...tarballs, "--workspaces=false", "--tag", Script.channel, "--access", "public"])
await fs.writeFile("package.json", JSON.stringify(original, null, 2))
