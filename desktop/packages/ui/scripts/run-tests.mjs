import { spawnSync } from "node:child_process"

const nodeOptions = new Set((process.env.NODE_OPTIONS ?? "").split(/\s+/).filter(Boolean))
nodeOptions.add("--no-experimental-webstorage")

const result = spawnSync("vitest", ["run", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    NODE_OPTIONS: [...nodeOptions].join(" "),
  },
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
