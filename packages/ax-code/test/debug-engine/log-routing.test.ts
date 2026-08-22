import { expect, test, vi } from "vitest"
import { createLogger } from "@ax-code/ax-code-reason/log"

test("reason package logs route through the core sink instead of raw stderr", () => {
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

  createLogger({ service: "debug-engine.test" }).info("routed")

  expect(stderr).not.toHaveBeenCalled()
  stderr.mockRestore()
})
