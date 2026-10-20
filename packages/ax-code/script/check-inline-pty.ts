// Python's standard-library PTY keeps this check independent of node-pty binaries.
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const result = spawnSync("python3", [fileURLToPath(new URL("inline-pty.py", import.meta.url)), process.execPath], {
  cwd: process.cwd(),
  env: process.env,
  encoding: "utf8",
  timeout: 180_000,
  maxBuffer: 16 * 1024 * 1024,
})
process.stdout.write(result.stdout ?? "")
process.stderr.write(result.stderr ?? "")
if (result.error) throw result.error
if (result.status !== 0) process.exitCode = 1
