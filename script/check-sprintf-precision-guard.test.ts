import { expect, test } from "vitest"
import { checkSprintfPrecisionGuard } from "./check-sprintf-precision-guard.mjs"

test("installed SQL Server peers bound numeric precision without changing valid formatting", () => {
  expect(checkSprintfPrecisionGuard).not.toThrow()
})
