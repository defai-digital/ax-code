import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

test("real PTY/ConPTY output passes the xterm Unicode, input, stream, resize and shutdown contract", () => {
  const script = fileURLToPath(new URL("../script/terminal-quality.ts", import.meta.url))
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8", timeout: 55000, maxBuffer: 2 * 1024 * 1024,
  })
  expect(result.error, result.stdout + result.stderr).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(JSON.parse(result.stdout).status).toBe("AX_TERMINAL_QUALITY_COMPLETE")
}, 60000)
