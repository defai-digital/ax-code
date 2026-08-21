import { expect, test, vi } from "vitest"
import { Log as PackageLog } from "@ax-code/ax-code-reason/internal/log"

test("reason package logs route through the core sink instead of raw stderr", () => {
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

  PackageLog.create({ service: "debug-engine.test" }).info("routed")

  expect(stderr).not.toHaveBeenCalled()
  stderr.mockRestore()
})
