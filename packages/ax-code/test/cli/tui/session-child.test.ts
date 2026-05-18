import { describe, expect, test } from "bun:test"
import { childAction, firstChildID, nextChildID } from "../../src/cli/cmd/tui/routes/session/child"

describe("tui session child helpers", () => {
  test("finds the first child session id", () => {
    expect(
      firstChildID([
        { id: "root", parentID: null },
        { id: "child-a", parentID: "root" },
        { id: "child-b", parentID: "root" },
      ]),
    ).toBe("child-a")
  })

  test("returns undefined when there is no child session to jump to", () => {
    expect(firstChildID([{ id: "root", parentID: null }])).toBeUndefined()
  })

  test("cycles to the next child session", () => {
    expect(
      nextChildID(
        [
          { id: "root", parentID: null },
          { id: "child-a", parentID: "root" },
          { id: "child-b", parentID: "root" },
        ],
        "child-a",
        1,
      ),
    ).toBe("child-b")
  })

  test("wraps around when cycling backwards", () => {
    expect(
      nextChildID(
        [
          { id: "root", parentID: null },
          { id: "child-a", parentID: "root" },
          { id: "child-b", parentID: "root" },
        ],
        "child-a",
        -1,
      ),
    ).toBe("child-b")
  })

  test("only allows child actions at dialog root for child sessions", () => {
    expect(childAction("root", 0)).toBe(true)
    expect(childAction("root", 1)).toBe(false)
    expect(childAction(undefined, 0)).toBe(false)
  })
})
