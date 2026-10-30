import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

test("seeded application churn bounds rows, subscriptions, focus, image loads, heap and teardown", () => {
  // 500 iterations produce five samples, so both the native-arena and JS-heap
  // guards actually execute instead of being skipped as warmup-only rows.
  const result = spawnSync(process.execPath, [
    "--experimental-ffi", "--disable-warning=ExperimentalWarning", "--expose-gc",
    fileURLToPath(new URL("../script/stress-application.ts", import.meta.url)), "500"], {
    encoding: "utf8", timeout: 45000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, AX_CODE_TUI_NATIVE_OFFLINE: "1" },
  })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  const summary = JSON.parse(result.stdout)
  expect(summary.status).toBe("AX_APPLICATION_STRESS_COMPLETE")
  expect(summary.heapSamples.length).toBe(5)
  expect(summary.executed).toBe(25)
  expect(summary.cancelledLoads).toBe(72)
}, 50000)
