import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

// POSIX PTYs are deliberately distinct from the all-platform native-buffer tests.
test.skipIf(process.platform === "win32")("real PTY preserves parked rows while streaming and bounds wheel repaints", () => {
  const result = spawnSync("python3", [fileURLToPath(new URL("fixtures/pty-scroll.py", import.meta.url)), process.execPath], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 40_000, maxBuffer: 2 * 1024 * 1024,
  })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  expect(result.stdout).toContain("AX_PTY_SCROLL_COMPLETE")
}, 45_000)
