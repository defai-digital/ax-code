import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

test("upstream split-footer output contracts on the AX native renderer", () => {
  const result = spawnSync(process.execPath, ["--experimental-ffi", "--disable-warning=ExperimentalWarning",
    "--test", fileURLToPath(new URL("fixtures/split-footer.mjs", import.meta.url))], {
    encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" },
  })
  expect(result.error, result.stdout + result.stderr).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
}, 35_000)
