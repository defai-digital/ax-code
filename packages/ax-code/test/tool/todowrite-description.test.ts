import { expect, test } from "vitest"
import DESCRIPTION from "../../src/tool/todowrite.txt"

test("todowrite description keeps decision rules and omits narrative examples", () => {
  expect(DESCRIPTION).toContain("3 or more distinct steps")
  expect(DESCRIPTION).toContain(
    "After receiving new instructions for an existing multi-step task - Update the todo list to capture changed or additional requirements.",
  )
  expect(DESCRIPTION).toContain("single, straightforward task")
  expect(DESCRIPTION).toContain(
    "When in doubt, apply the rules above: use the list when the task has 3+ distinct steps or the user gave several tasks; skip it for single-step, trivial, or informational requests.",
  )
  expect(DESCRIPTION).toContain("in_progress: Currently working on")
  expect(DESCRIPTION).not.toContain("<example>")
  expect(DESCRIPTION).not.toContain("When in doubt, use this tool")
})
